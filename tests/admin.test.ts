// The operator surface's guard.
//
// requireAdmin() itself needs a session, so what is unit-testable here is the
// allowlist decision — which is the whole of the authorization logic. The
// session plumbing around it is one `auth()` call and an early return.
//
// The cases that matter are the refusals, same as tests/scope.test.ts. An
// allowlist that fails OPEN is worse than no allowlist, because it looks like
// a control.

import { describe, it, expect, afterEach } from "vitest";
import { adminEmails, isAdminEmail } from "@/lib/admin";
import {
  isAssignableRole,
  isAssignableStatus,
  isSelfAction,
  ASSIGNABLE_ROLES,
  ASSIGNABLE_STATUSES,
} from "@/lib/admin-actions";
import { adminUiEnabled } from "@/lib/features";

const ADMIN = "dylaan.cannon@gmail.com";
const OTHER = "someone.else@example.com";

afterEach(() => {
  delete process.env.OSPREY_ADMIN_EMAILS;
  delete process.env.OSPREY_ADMIN_UI;
});

describe("adminEmails — parsing", () => {
  it("is empty when unset", () => {
    expect(adminEmails()).toEqual([]);
  });

  it("parses a comma-separated list, trimming and lower-casing", () => {
    process.env.OSPREY_ADMIN_EMAILS = ` ${ADMIN.toUpperCase()} , ${OTHER} `;
    expect(adminEmails()).toEqual([ADMIN, OTHER]);
  });

  it("drops empty entries from trailing or doubled commas", () => {
    process.env.OSPREY_ADMIN_EMAILS = `${ADMIN},,  ,`;
    expect(adminEmails()).toEqual([ADMIN]);
  });

  it("re-reads the environment on every call", () => {
    // Revocation without a deploy is the entire reason this lives in the env
    // rather than the database. Caching at module load would silently take
    // that away, and nothing else would fail.
    process.env.OSPREY_ADMIN_EMAILS = ADMIN;
    expect(isAdminEmail(ADMIN)).toBe(true);
    process.env.OSPREY_ADMIN_EMAILS = "";
    expect(isAdminEmail(ADMIN)).toBe(false);
  });
});

describe("isAdminEmail — the refusals", () => {
  it("matches nobody when the allowlist is unset", () => {
    // Failing open here would make every signed-in user an operator on any
    // environment that forgot the variable — a preview deployment, a new
    // Vercel project, a local .env.local.
    expect(isAdminEmail(ADMIN)).toBe(false);
    expect(isAdminEmail(OTHER)).toBe(false);
  });

  it("matches nobody when the allowlist is empty or whitespace", () => {
    for (const value of ["", "  ", ",", " , "]) {
      process.env.OSPREY_ADMIN_EMAILS = value;
      expect(isAdminEmail(ADMIN), `allowlist=${JSON.stringify(value)}`).toBe(false);
    }
  });

  it("refuses an email that is not on the list", () => {
    process.env.OSPREY_ADMIN_EMAILS = ADMIN;
    expect(isAdminEmail(OTHER)).toBe(false);
  });

  it("refuses null, undefined, and empty session emails", () => {
    process.env.OSPREY_ADMIN_EMAILS = ADMIN;
    expect(isAdminEmail(null)).toBe(false);
    expect(isAdminEmail(undefined)).toBe(false);
    expect(isAdminEmail("")).toBe(false);
  });

  it("does not match on a prefix, suffix, or substring", () => {
    process.env.OSPREY_ADMIN_EMAILS = ADMIN;
    for (const near of [
      "dylaan.cannon@gmail.com.evil.example",
      "evil.example/dylaan.cannon@gmail.com",
      "dylaan.cannon@gmail.co",
      "ddylaan.cannon@gmail.com",
    ]) {
      expect(isAdminEmail(near), near).toBe(false);
    }
  });

  it("accepts an exact match regardless of case or surrounding space", () => {
    process.env.OSPREY_ADMIN_EMAILS = ADMIN;
    expect(isAdminEmail(ADMIN)).toBe(true);
    expect(isAdminEmail("Dylaan.Cannon@Gmail.com")).toBe(true);
    expect(isAdminEmail(`  ${ADMIN}  `)).toBe(true);
  });
});

describe("adminUiEnabled — the kill switch", () => {
  it("is off unless the value is exactly 'true'", () => {
    // Matches agentAccountsEnabled(). "1", "yes", and "TRUE" are all off, so
    // there is exactly one string that turns an operator surface on.
    for (const value of ["", "1", "yes", "TRUE", "True", "false"]) {
      process.env.OSPREY_ADMIN_UI = value;
      expect(adminUiEnabled(), `OSPREY_ADMIN_UI=${JSON.stringify(value)}`).toBe(false);
    }
    process.env.OSPREY_ADMIN_UI = "true";
    expect(adminUiEnabled()).toBe(true);
  });

  it("is off when unset", () => {
    expect(adminUiEnabled()).toBe(false);
  });

  it("is independent of the allowlist", () => {
    // Two gates, both required. Turning the surface on grants nobody access,
    // and being on the allowlist reaches nothing while the surface is off.
    process.env.OSPREY_ADMIN_EMAILS = ADMIN;
    expect(adminUiEnabled()).toBe(false);

    process.env.OSPREY_ADMIN_UI = "true";
    delete process.env.OSPREY_ADMIN_EMAILS;
    expect(adminUiEnabled()).toBe(true);
    expect(isAdminEmail(ADMIN)).toBe(false);
  });
});

// --- v1b -------------------------------------------------------------------

describe("assignable values — what an operator may set", () => {
  it("accepts only investor and agent as roles", () => {
    expect(ASSIGNABLE_ROLES).toEqual(["investor", "agent"]);
    expect(isAssignableRole("investor")).toBe(true);
    expect(isAssignableRole("agent")).toBe(true);
  });

  it("refuses brokerage_admin even though the column permits it", () => {
    // users_role_check allows it, but Phase 4 does not exist — granting it
    // would create an account with a role nothing in the product implements.
    expect(isAssignableRole("brokerage_admin")).toBe(false);
  });

  it("accepts only active and suspended as statuses", () => {
    expect(ASSIGNABLE_STATUSES).toEqual(["active", "suspended"]);
    expect(isAssignableStatus("active")).toBe(true);
    expect(isAssignableStatus("suspended")).toBe(true);
  });

  it("refuses the agent-managed lifecycle statuses", () => {
    // 'managed' and 'invited' are owned by the agent-accounts flow. An operator
    // hand-setting one produces a client with no roster row and no invite — a
    // broken account that looks deliberate.
    expect(isAssignableStatus("managed")).toBe(false);
    expect(isAssignableStatus("invited")).toBe(false);
  });

  it("refuses non-strings and near-misses", () => {
    for (const bad of [null, undefined, 42, {}, [], "", "AGENT", "Active", "admin", "root"]) {
      expect(isAssignableRole(bad), `role=${JSON.stringify(bad)}`).toBe(false);
      expect(isAssignableStatus(bad), `status=${JSON.stringify(bad)}`).toBe(false);
    }
  });
});

describe("isSelfAction — guardrail #1", () => {
  it("recognises the operator's own account", () => {
    expect(isSelfAction(ADMIN, ADMIN)).toBe(true);
  });

  it("ignores case and surrounding whitespace on both sides", () => {
    // The allowlist lower-cases; a users row may not. A guard that missed on
    // casing would let an operator suspend themselves and lock themselves out
    // of the only tool that could undo it.
    expect(isSelfAction(ADMIN, "Dylaan.Cannon@Gmail.com")).toBe(true);
    expect(isSelfAction(ADMIN, `  ${ADMIN} `)).toBe(true);
  });

  it("does not fire on a different account", () => {
    expect(isSelfAction(ADMIN, OTHER)).toBe(false);
  });

  it("does not fire on a missing target email", () => {
    // Fails OPEN here, deliberately, and that is safe: this function only ever
    // BLOCKS an action. A null target email means the row is not the operator's
    // account, so there is nothing to protect them from — and the SQL WHERE
    // clause is the real guard regardless.
    expect(isSelfAction(ADMIN, null)).toBe(false);
    expect(isSelfAction(ADMIN, undefined)).toBe(false);
    expect(isSelfAction(ADMIN, "")).toBe(false);
  });
});
