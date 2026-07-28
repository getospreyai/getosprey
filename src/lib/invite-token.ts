// Invite tokens: mint, hash, expire.
//
// An invite token is the single most dangerous string in this codebase. Holding
// one lets an anonymous stranger set the password on a real users row and sign
// in as that person. Everything here follows from that.
//
//  * 32 bytes of CSPRNG. docs/AGENT-ACCOUNTS-PLAN.md §3a T6 specified
//    crypto.randomUUID(); this is a deliberate departure. A v4 UUID is 122 bits
//    of randomness (6 of its 128 bits are fixed version/variant markers), which
//    is not brute-forceable — the parent plan is not wrong. But 256 bits costs
//    nothing, and a UUID has a specific liability: it LOOKS like an identifier,
//    so it is the kind of value that ends up in a log line, pasted into a
//    support ticket, or reused as a database key by a later change. The `osp_`
//    prefix exists so that if one ever does leak into a log, it is greppable.
//
//  * The token is returned to the caller ONCE, at mint. Only its sha256 is
//    stored. There is deliberately no way to recover a token from the database
//    — see the storage note in db/schema.sql. If an agent loses the link they
//    re-mint, which revokes the old one.
//
//  * Plain sha256, no salt, no KDF. Correct HERE and nowhere near passwords:
//    the input is 256 bits of uniform randomness, so there is no dictionary and
//    no rainbow table. The slow-hash argument that makes bcrypt right for
//    passwords buys nothing against a random 256-bit secret, and bcrypt's
//    72-byte truncation would actively work against us.

import { createHash, randomBytes } from "node:crypto";

/** How long a minted invite stays usable.
 *
 *  Seven days. The agent hands the link over directly through a channel they
 *  already use with the client (AGENT-ACCOUNTS-PLAN.md §9 — Osprey sends no
 *  email), so there is no deliverability lag to absorb; this is sized for "I'll
 *  text it to them tonight," not for an inbox. */
export const INVITE_TTL_DAYS = 7;

/** Marks the string as a secret to anyone reading a log, and lets a leaked
 *  token be found by grep. Not a security control on its own. */
const TOKEN_PREFIX = "osp_inv_";

/** 32 bytes → 43 base64url characters. */
const TOKEN_BODY_RE = /^[A-Za-z0-9_-]{43}$/;

export interface MintedInvite {
  /** Shown to the agent once and never stored. */
  token: string;
  /** What goes in client_invites.token_hash. */
  tokenHash: string;
  expiresAt: Date;
}

/** sha256 hex of a token. Stable, so it can be used as the lookup key. */
export function hashInviteToken(token: string): string {
  return createHash("sha256").update(token, "utf8").digest("hex");
}

/**
 * Cheap shape check, so an obviously malformed token is refused without a
 * database round trip.
 *
 * This does NOT create a timing oracle worth caring about: the caller renders
 * one identical refusal for malformed, expired, revoked, accepted, and
 * never-existed, and the timing gap between a regex and an indexed lookup tells
 * an attacker nothing they cannot already learn by sending garbage. Same
 * reasoning as the UUID_RE guard in src/lib/scope.ts.
 */
export function looksLikeInviteToken(token: unknown): token is string {
  if (typeof token !== "string") return false;
  if (!token.startsWith(TOKEN_PREFIX)) return false;
  return TOKEN_BODY_RE.test(token.slice(TOKEN_PREFIX.length));
}

/** When an invite minted at `from` stops being usable. */
export function inviteExpiry(from: Date = new Date()): Date {
  return new Date(from.getTime() + INVITE_TTL_DAYS * 24 * 60 * 60 * 1000);
}

/**
 * Mint a fresh invite. The returned `token` is the only copy that will ever
 * exist — persist `tokenHash`, hand `token` to the agent, and let it go.
 */
export function mintInviteToken(now: Date = new Date()): MintedInvite {
  const token = TOKEN_PREFIX + randomBytes(32).toString("base64url");
  return {
    token,
    tokenHash: hashInviteToken(token),
    expiresAt: inviteExpiry(now),
  };
}

/**
 * Whether an invite row is still usable, given the clock.
 *
 * Kept as a pure function next to the token itself so the rule is stated once.
 * It is NOT the enforcement point — enforcement is the conditional UPDATE in
 * PgStore.acceptInvite(), whose WHERE clause is the same predicate evaluated
 * atomically in Postgres. Two simultaneous clicks on one link must resolve to
 * exactly one winner, which no amount of application-level checking can
 * guarantee. This exists for rendering (is this link dead?) and for tests.
 */
export function isInviteUsable(
  invite: { expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null },
  now: Date = new Date(),
): boolean {
  if (invite.acceptedAt !== null) return false;
  if (invite.revokedAt !== null) return false;
  // Expiry is exclusive: an invite whose expires_at is exactly now is spent.
  // Matches `expires_at > now()` in the SQL.
  return invite.expiresAt.getTime() > now.getTime();
}
