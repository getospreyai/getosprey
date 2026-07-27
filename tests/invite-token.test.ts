// Invite tokens are the one string in this codebase that lets an anonymous
// stranger become a real user. These tests pin the three properties that makes
// safe: enough entropy that guessing is hopeless, a stored form that is useless
// to whoever reads the database, and an expiry boundary that is not off by one.

import { describe, it, expect } from "vitest";
import {
  INVITE_TTL_DAYS,
  hashInviteToken,
  inviteExpiry,
  isInviteUsable,
  looksLikeInviteToken,
  mintInviteToken,
} from "@/lib/invite-token";

describe("mintInviteToken — entropy", () => {
  it("carries 256 bits of randomness in the token body", () => {
    const { token } = mintInviteToken();
    const body = token.replace(/^osp_inv_/, "");
    // 32 bytes base64url, unpadded, is exactly 43 characters.
    expect(body).toHaveLength(43);
    expect(body).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("is prefixed so a leaked token is greppable in a log", () => {
    expect(mintInviteToken().token.startsWith("osp_inv_")).toBe(true);
  });

  it("never repeats across 10k mints", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 10_000; i++) seen.add(mintInviteToken().token);
    expect(seen.size).toBe(10_000);
  });

  it("does not reuse randomness between the token and its hash", () => {
    // Guards against a refactor that "optimizes" by deriving one from a shared
    // buffer and accidentally makes the stored value reversible.
    const { token, tokenHash } = mintInviteToken();
    expect(tokenHash).not.toContain(token);
    expect(token).not.toContain(tokenHash);
  });
});

describe("hashInviteToken — what the database gets", () => {
  it("is stable, so it works as a lookup key", () => {
    const { token } = mintInviteToken();
    expect(hashInviteToken(token)).toBe(hashInviteToken(token));
  });

  it("is sha256 hex", () => {
    expect(hashInviteToken("osp_inv_whatever")).toMatch(/^[0-9a-f]{64}$/);
  });

  it("differs for tokens differing by one character", () => {
    expect(hashInviteToken("osp_inv_a")).not.toBe(hashInviteToken("osp_inv_b"));
  });

  it("THE POINT: the stored hash does not contain the token", () => {
    // If this ever fails, the database has become a source of live credentials
    // and every backup is an account-takeover kit.
    const { token, tokenHash } = mintInviteToken();
    expect(tokenHash).not.toBe(token);
    expect(tokenHash.includes(token.slice(8, 20))).toBe(false);
  });
});

describe("looksLikeInviteToken", () => {
  it("accepts a freshly minted token", () => {
    expect(looksLikeInviteToken(mintInviteToken().token)).toBe(true);
  });

  it("rejects a bare UUID — the shape the parent plan originally specified", () => {
    expect(looksLikeInviteToken(crypto.randomUUID())).toBe(false);
  });

  it("rejects the prefix alone, the empty string, and non-strings", () => {
    expect(looksLikeInviteToken("osp_inv_")).toBe(false);
    expect(looksLikeInviteToken("")).toBe(false);
    expect(looksLikeInviteToken(null)).toBe(false);
    expect(looksLikeInviteToken(undefined)).toBe(false);
    expect(looksLikeInviteToken(42)).toBe(false);
  });

  it("rejects a body of the right length but the wrong alphabet", () => {
    expect(looksLikeInviteToken("osp_inv_" + "!".repeat(43))).toBe(false);
  });

  it("rejects a correctly-shaped body without the prefix", () => {
    expect(looksLikeInviteToken("a".repeat(43))).toBe(false);
  });

  it("rejects SQL and path traversal payloads", () => {
    expect(looksLikeInviteToken("osp_inv_' OR 1=1 --")).toBe(false);
    expect(looksLikeInviteToken("../../etc/passwd")).toBe(false);
  });
});

describe("inviteExpiry", () => {
  it("is INVITE_TTL_DAYS out from the given moment", () => {
    const now = new Date("2026-07-27T12:00:00.000Z");
    expect(inviteExpiry(now).toISOString()).toBe("2026-08-03T12:00:00.000Z");
    expect(INVITE_TTL_DAYS).toBe(7);
  });
});

describe("isInviteUsable", () => {
  const now = new Date("2026-07-27T12:00:00.000Z");
  const live = {
    expiresAt: new Date("2026-08-03T12:00:00.000Z"),
    acceptedAt: null,
    revokedAt: null,
  };

  it("accepts an outstanding, unexpired invite", () => {
    expect(isInviteUsable(live, now)).toBe(true);
  });

  it("refuses one already accepted — single use", () => {
    expect(isInviteUsable({ ...live, acceptedAt: now }, now)).toBe(false);
  });

  it("refuses one revoked", () => {
    expect(isInviteUsable({ ...live, revokedAt: now }, now)).toBe(false);
  });

  it("refuses one that is both accepted and revoked", () => {
    expect(isInviteUsable({ ...live, acceptedAt: now, revokedAt: now }, now)).toBe(false);
  });

  it("refuses one that has expired", () => {
    expect(isInviteUsable({ ...live, expiresAt: new Date(now.getTime() - 1) }, now)).toBe(false);
  });

  it("BOUNDARY: expires_at exactly now is already spent", () => {
    // Exclusive, matching `expires_at > now()` in acceptInvite's WHERE clause.
    // If these two ever disagree, a link renders as dead and still works.
    expect(isInviteUsable({ ...live, expiresAt: now }, now)).toBe(false);
  });

  it("BOUNDARY: one millisecond before expiry still works", () => {
    expect(
      isInviteUsable({ ...live, expiresAt: new Date(now.getTime() + 1) }, now),
    ).toBe(true);
  });

  it("a freshly minted invite is usable at its mint moment", () => {
    const minted = mintInviteToken(now);
    expect(
      isInviteUsable(
        { expiresAt: minted.expiresAt, acceptedAt: null, revokedAt: null },
        now,
      ),
    ).toBe(true);
  });
});
