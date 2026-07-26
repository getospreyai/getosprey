// Ship gate #2: "a managed account cannot authenticate by any input."
//
// The first block pins bcryptjs's actual behavior on a non-string digest,
// measured against a Neon branch on 2026-07-26. It is a test of a third-party
// library, which is normally a smell — but our guard exists *because* of this
// behavior, so if a bcryptjs upgrade ever changes it, we want to be told rather
// than to quietly keep a control whose rationale has evaporated.

import { describe, it, expect } from "vitest";
import bcrypt from "bcryptjs";
import { canAuthenticate } from "@/lib/auth-guard";

describe("bcryptjs — why the guard exists", () => {
  it("THROWS rather than returning false when the digest is null", async () => {
    await expect(
      bcrypt.compare("anything", null as unknown as string),
    ).rejects.toThrow(/Illegal arguments/);
  });

  it("THROWS when the digest is undefined", async () => {
    await expect(
      bcrypt.compare("anything", undefined as unknown as string),
    ).rejects.toThrow(/Illegal arguments/);
  });

  it("returns false for an empty-string digest", async () => {
    await expect(bcrypt.compare("anything", "")).resolves.toBe(false);
  });
});

describe("canAuthenticate", () => {
  const hash = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

  it("allows an active user with a real hash", () => {
    expect(canAuthenticate({ password_hash: hash, status: "active" })).toBe(true);
  });

  it("allows a row whose status column was not selected", () => {
    // The hash check is the authoritative control; an unknown status must not
    // lock out existing users if some query forgets to select the column.
    expect(canAuthenticate({ password_hash: hash })).toBe(true);
    expect(canAuthenticate({ password_hash: hash, status: null })).toBe(true);
  });

  it("refuses a managed client (null hash) — the whole point", () => {
    expect(canAuthenticate({ password_hash: null, status: "managed" })).toBe(false);
  });

  it("refuses an invited client", () => {
    expect(canAuthenticate({ password_hash: null, status: "invited" })).toBe(false);
  });

  it("refuses any row with no usable hash, whatever its status", () => {
    for (const status of ["active", "managed", "invited", null, undefined]) {
      expect(canAuthenticate({ password_hash: null, status })).toBe(false);
      expect(canAuthenticate({ password_hash: "", status })).toBe(false);
    }
  });

  // Defense in depth: if a managed row ever acquires a hash it should not
  // have, status alone still denies it.
  it("refuses a managed/invited row even if it somehow has a hash", () => {
    expect(canAuthenticate({ password_hash: hash, status: "managed" })).toBe(false);
    expect(canAuthenticate({ password_hash: hash, status: "invited" })).toBe(false);
  });

  it("never returns true for a non-string hash of any shape", () => {
    for (const bad of [null, undefined, 0, false, {}, []]) {
      expect(
        canAuthenticate({ password_hash: bad as unknown as string | null, status: "active" }),
      ).toBe(false);
    }
  });
});
