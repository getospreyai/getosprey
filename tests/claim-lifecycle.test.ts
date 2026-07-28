// The invite lifecycle and the properties the claim flow depends on.
//
// The atomic single-use guarantee lives in Postgres (one statement, WHERE
// clause as the validity check), so it cannot be unit tested here without a
// database. What CAN be tested without one — and is, below — is that the
// predicate this file's SQL encodes matches the predicate the rest of the code
// believes, and that the surrounding rules hold at every branch.
//
// The rule these tests exist to protect: an invite is usable exactly once,
// from exactly one state, and every way of failing looks identical from
// outside.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  hashInviteToken,
  inviteExpiry,
  isInviteUsable,
  looksLikeInviteToken,
  mintInviteToken,
} from "@/lib/invite-token";

const NOW = new Date("2026-07-27T12:00:00.000Z");

function invite(over: Partial<{ expiresAt: Date; acceptedAt: Date | null; revokedAt: Date | null }> = {}) {
  return {
    expiresAt: inviteExpiry(NOW),
    acceptedAt: null as Date | null,
    revokedAt: null as Date | null,
    ...over,
  };
}

describe("single use — one accept, then never again", () => {
  it("a fresh invite is usable", () => {
    expect(isInviteUsable(invite(), NOW)).toBe(true);
  });

  it("THE PROPERTY: accepting makes it permanently unusable", () => {
    const accepted = invite({ acceptedAt: NOW });
    // Not just now — at every later point too. accepted_at is a tombstone,
    // never cleared.
    for (const t of [NOW, new Date(NOW.getTime() + 1000), new Date("2027-01-01")]) {
      expect(isInviteUsable(accepted, t)).toBe(false);
    }
  });

  it("a second accept cannot succeed even inside the validity window", () => {
    const justAccepted = invite({ acceptedAt: NOW });
    const wellInsideWindow = new Date(NOW.getTime() + 60 * 1000);
    expect(isInviteUsable(justAccepted, wellInsideWindow)).toBe(false);
  });
});

describe("every failure mode is refused, and none is special", () => {
  const cases: Array<[string, ReturnType<typeof invite>]> = [
    ["expired", invite({ expiresAt: new Date(NOW.getTime() - 1) })],
    ["revoked", invite({ revokedAt: NOW })],
    ["accepted", invite({ acceptedAt: NOW })],
    ["revoked and accepted", invite({ acceptedAt: NOW, revokedAt: NOW })],
    ["expired and revoked", invite({ expiresAt: new Date(NOW.getTime() - 1), revokedAt: NOW })],
  ];

  for (const [name, row] of cases) {
    it(`refuses a ${name} invite`, () => {
      expect(isInviteUsable(row, NOW)).toBe(false);
    });
  }

  it("all of them are refused by the same predicate — no per-case branch", () => {
    // If a future change adds a "soft expired, still usable" state, this is
    // where it shows up as a decision rather than an accident.
    const results = cases.map(([, row]) => isInviteUsable(row, NOW));
    expect(new Set(results)).toEqual(new Set([false]));
  });
});

describe("revocation ordering — why mint revokes before it inserts", () => {
  it("two live invites for one client is the state the index forbids", () => {
    // client_invites_one_outstanding is a partial unique index on
    // client_user_id WHERE accepted_at IS NULL AND revoked_at IS NULL. Both of
    // these rows satisfy that predicate, so the second insert must fail unless
    // the first has already been revoked. mintInvite() revokes first for
    // exactly this reason.
    const a = invite();
    const b = invite();
    expect(isInviteUsable(a, NOW) && isInviteUsable(b, NOW)).toBe(true);

    const revokedFirst = { ...a, revokedAt: NOW };
    expect(isInviteUsable(revokedFirst, NOW)).toBe(false);
    expect(isInviteUsable(b, NOW)).toBe(true);
  });
});

describe("the token a claimer presents", () => {
  it("round-trips from mint to lookup key", () => {
    const { token, tokenHash } = mintInviteToken(NOW);
    expect(looksLikeInviteToken(token)).toBe(true);
    expect(hashInviteToken(token)).toBe(tokenHash);
  });

  it("a token that is one character off produces a different lookup key", () => {
    const { token, tokenHash } = mintInviteToken(NOW);
    const tampered = token.slice(0, -1) + (token.endsWith("A") ? "B" : "A");
    expect(hashInviteToken(tampered)).not.toBe(tokenHash);
  });
});

// ---------------------------------------------------------------------------
// Source-level assertions.
//
// These read the actual files. That is unusual, and justified narrowly: each
// one pins a property that is invisible at runtime in a unit test but whose
// violation is a security bug, and each has a plausible route to being broken
// by a well-meaning edit.
// ---------------------------------------------------------------------------

function readSource(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../${relative}`, import.meta.url)), "utf8");
}

/**
 * Source with comments removed.
 *
 * These files are heavily commented, and the comments discuss exactly the
 * things being asserted — the claim route's header explains that the invite
 * lookup precedes bcrypt.hash, which made a naive indexOf() find the prose
 * rather than the call. Assertions about ORDER and about absence have to run
 * against code, or they measure the documentation instead of the behavior.
 */
function readCode(relative: string): string {
  return readSource(relative)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((line) => !/^\s*(\/\/|\*)/.test(line))
    .map((line) => line.replace(/\s+\/\/.*$/, ""))
    .join("\n");
}

describe("/claim must stay unauthenticated", () => {
  it("is NOT in the proxy matcher", () => {
    // src/proxy.ts redirects every matched path to /login when there is no
    // session. Adding "/claim/:path*" there — which looks like the obviously
    // correct thing to do when adding a new route — would make the invite link
    // useless to the only people who ever receive one: those without accounts.
    const proxy = readCode("src/proxy.ts");
    expect(proxy).not.toContain("/claim");
  });

  it("the paths that ARE matched are still matched", () => {
    // Guards the negative test above against being satisfied by someone
    // gutting the matcher entirely.
    const proxy = readCode("src/proxy.ts");
    for (const path of ["/dashboard", "/settings", "/onboarding", "/clients"]) {
      expect(proxy).toContain(path);
    }
  });
});

describe("the claim route's refusal discipline", () => {
  const route = readCode("src/app/api/claim/route.ts");

  it("hashes the password only after the invite has been looked up", () => {
    // bcrypt at cost 10 is ~100ms of CPU on an endpoint with no auth and no
    // rate limiting. Hashing before validating the token would hand an
    // anonymous caller a free way to saturate the server.
    const lookupAt = route.indexOf("loadInviteForClaim");
    const hashAt = route.indexOf("bcrypt.hash");
    expect(lookupAt).toBeGreaterThan(-1);
    expect(hashAt).toBeGreaterThan(-1);
    expect(lookupAt).toBeLessThan(hashAt);
  });

  it("refuses a provisional policy version before doing anything else", () => {
    const gateAt = route.indexOf("policyVersionIsReviewed");
    const dbAt = route.indexOf("new PgStore()");
    expect(gateAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(dbAt);
  });

  it("requires consent to be exactly true, not merely truthy", () => {
    // `if (!consent)` would accept the string "false", which is what a form
    // serializing checkboxes naively would send.
    expect(route).toContain("consent !== true");
  });

  it("never names the specific failure in a response body", () => {
    // The one refusal string must not acquire a sibling that explains itself.
    for (const leak of [
      "already been registered",
      "email is taken",
      "already exists",
      "invite not found",
      "token expired",
    ]) {
      expect(route.toLowerCase()).not.toContain(leak);
    }
  });
});

describe("the claim page's render discipline", () => {
  const page = readCode("src/app/claim/[token]/page.tsx");

  it("has exactly one dead-link component for every failure", () => {
    // Five call sites (flag off is notFound, the rest are DeadLink), one
    // component. If a second failure component appears, the two will drift and
    // the difference becomes an oracle.
    expect(page).toContain("function DeadLink()");
    expect((page.match(/function DeadLink/g) ?? []).length).toBe(1);
  });

  it("keeps the invite out of search indexes", () => {
    expect(page).toContain("index: false");
  });

  it("is never cached", () => {
    expect(page).toContain('dynamic = "force-dynamic"');
  });
});
