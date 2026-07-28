// Accept an invite and claim a managed account.
//
// This is the only unauthenticated, state-changing endpoint in Osprey, and the
// state it changes is "who can log in as this user." Read the whole file
// before touching it.
//
// Four things are load-bearing:
//
//  1. EVERY failure returns the same body and status. Not "link expired" vs
//     "email taken" vs "no such invite" — one refusal. An unauthenticated
//     caller who can distinguish those can enumerate both live tokens and
//     registered email addresses (docs/AGENT-ACCOUNTS-PLAN.md §3a T4).
//
//  2. The single-use guarantee lives in Postgres, not here. PgStore.claimInvite
//     is one statement whose WHERE clause is the validity check, so two
//     simultaneous clicks on one link resolve to exactly one winner. Do not
//     "simplify" it into a read-then-write.
//
//  3. It refuses entirely while POLICY_VERSION is provisional. Ship gate #5:
//     recording a consent that points at text which does not describe the
//     agent relationship is worse than not recording one, because it looks
//     like compliance.
//
//  4. The invite lookup happens BEFORE bcrypt.hash. bcrypt at cost 10 is
//     ~100ms of CPU; doing it before validating the token would hand an
//     anonymous caller a cheap way to saturate the server. Ordering is the
//     mitigation — this repo has no rate limiter, which is acceptable against
//     a 256-bit token but not against unbounded free bcrypt.
//
// There is deliberately NO auto-sign-in on success. It would mean an
// unauthenticated endpoint mints a session, and the claimer has just chosen a
// password they should prove they can use.

import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { hasDb, ensureSchema } from "@/lib/db";
import { agentAccountsEnabled } from "@/lib/features";
import {
  AGENT_ACCESS_DISCLOSURE,
  POLICY_VERSION,
  policyVersionIsReviewed,
} from "@/lib/legal";
import { hashInviteToken, looksLikeInviteToken } from "@/lib/invite-token";
import { PgStore } from "@/osprey/pg-store";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Matches signup's minimum (src/app/api/signup/route.ts) — a claimed account
 *  is an ordinary account and should not have a weaker password rule. */
const MIN_PASSWORD_LENGTH = 8;

/**
 * THE refusal. One body, one status, for every reason this route can fail.
 *
 * Expired, revoked, already accepted, never existed, malformed, wrong client
 * state, and "that email already has an Osprey account" all land here. The
 * last one is the uncomfortable case: a real person with an existing account
 * hits a dead end with no explanation. That is the correct trade — the
 * alternative is telling an anonymous caller which addresses are registered,
 * and the population affected is small (someone whose agent created a managed
 * row for an address they had already signed up with). Flow B in
 * docs/PHASE-2-INVITES-PLAN.md §2 is what solves it properly.
 */
function refuse() {
  return NextResponse.json(
    {
      error:
        "We couldn't finish setting up this account. This link may have expired or already been used — please contact your agent for a new one.",
    },
    { status: 400, ...NO_STORE },
  );
}

export async function POST(req: NextRequest) {
  if (!agentAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }

  // Ship gate #5. Refuse before touching anything: a claim recorded against
  // PROVISIONAL text would be a consent row nobody can interpret later.
  if (!policyVersionIsReviewed()) {
    console.error(
      "POST /api/claim: refused — POLICY_VERSION is PROVISIONAL but OSPREY_AGENT_ACCOUNTS is on. Ship gate #5 is not met.",
    );
    return NextResponse.json(
      { error: "Account claiming isn't available yet. Please contact your agent." },
      { status: 503, ...NO_STORE },
    );
  }

  if (!hasDb()) {
    return NextResponse.json(
      { error: "Account claiming is temporarily unavailable. Please try again later." },
      { status: 503, ...NO_STORE },
    );
  }

  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;

  const token = body?.token;
  const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
  const email = emailRaw.toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";
  const consent = body?.consent;

  // Consent must be an explicit, affirmative true. Not "truthy" — a stray
  // string or a 1 from some future client must not read as agreement to hand
  // an agent access to this person's financial data.
  if (consent !== true) {
    return NextResponse.json(
      { error: "Please confirm you understand what your agent will be able to see." },
      { status: 400, ...NO_STORE },
    );
  }

  // Shape check before any database work, and well before bcrypt.
  if (!looksLikeInviteToken(token)) return refuse();

  // Field validation gets REAL messages: these are the claimer's own inputs,
  // so telling them the password is too short reveals nothing about anyone.
  // Everything about the INVITE stays generic.
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400, ...NO_STORE },
    );
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    return NextResponse.json(
      { error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.` },
      { status: 400, ...NO_STORE },
    );
  }

  const store = new PgStore();
  const tokenHash = hashInviteToken(token);

  try {
    await ensureSchema();

    // Cheap, indexed pre-check so an invalid token is refused without paying
    // for a bcrypt hash. NOT the enforcement point — claimInvite re-checks the
    // same predicate atomically, which is what makes single-use real. This
    // read only exists to keep the expensive path behind a valid token.
    const invite = await store.loadInviteForClaim(tokenHash);
    if (!invite) return refuse();

    const passwordHash = await bcrypt.hash(password, 10);

    const claimed = await store.claimInvite({
      tokenHash,
      email,
      passwordHash,
      policyVersion: POLICY_VERSION,
      disclosure: AGENT_ACCESS_DISCLOSURE,
    });

    // Lost the race, or the invite went stale between the two reads. Same
    // refusal as everything else.
    if (!claimed) return refuse();

    return NextResponse.json({ ok: true }, NO_STORE);
  } catch (err) {
    // The expected error here is 23505 on users.email — the claimer typed an
    // address that already has an Osprey account. It is logged in full and
    // reported as the generic refusal, because naming it would tell an
    // anonymous caller which addresses are registered.
    //
    // Because claimInvite is a single statement, this rollback leaves the
    // invite OUTSTANDING, so they can retry with a different address rather
    // than being stranded by a link that is now spent.
    console.error("Claim failed:", err);
    return refuse();
  }
}
