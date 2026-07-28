// What an operator is allowed to change, and on whom.
//
// Pure, like src/lib/admin.ts and for the same reason — the routes that use
// this import next-auth, which vitest cannot load. Everything decidable without
// a database lives here so it can be tested exhaustively.
//
// The values are deliberately narrow. v1 grants exactly two toggles, and the
// allowlists below are what stop a request body from reaching the database with
// a role or status the rest of the product has never heard of. `users_role_check`
// and `users_status_check` would also reject it, but a 500 from a constraint
// violation is a worse answer than a 400, and relying on the database to
// validate input means the error message is a Postgres string.

/** Roles an operator may assign. `brokerage_admin` is permitted by the column's
 *  check constraint but belongs to Phase 4, which does not exist — granting it
 *  today would create an account with a role nothing implements. */
export const ASSIGNABLE_ROLES = ["investor", "agent"] as const;
export type AssignableRole = (typeof ASSIGNABLE_ROLES)[number];

/** Statuses an operator may set. `managed` and `invited` are NOT here: they are
 *  lifecycle states owned by the agent-accounts flow, and an operator hand-
 *  setting one would produce a client with no roster row, no invite, and no way
 *  to sign in — a broken account that looks deliberate. */
export const ASSIGNABLE_STATUSES = ["active", "suspended"] as const;
export type AssignableStatus = (typeof ASSIGNABLE_STATUSES)[number];

export function isAssignableRole(value: unknown): value is AssignableRole {
  return typeof value === "string" && (ASSIGNABLE_ROLES as readonly string[]).includes(value);
}

export function isAssignableStatus(value: unknown): value is AssignableStatus {
  return typeof value === "string" && (ASSIGNABLE_STATUSES as readonly string[]).includes(value);
}

/**
 * Is the operator acting on their own account?
 *
 * Guardrail #1 (docs/ADMIN-UI-PLAN.md §8): an admin must not be able to suspend
 * or demote themselves. Suspending yourself is the dangerous one — `status`
 * leaves the `canActAsViewer()` allowlist, your session stops working on the
 * next request, and the tooling that could undo it is the tooling you just
 * locked yourself out of. There is no self-service recovery: it would take a
 * manual UPDATE against production, which is the exact thing this UI exists to
 * eliminate.
 *
 * Demotion is less severe — admin comes from the env allowlist, not from
 * `role`, so demoting your own role does not cost you /admin — but it is
 * blocked too, because "the operator cannot act on themselves" is a rule that
 * is easier to reason about with no exceptions than with one.
 *
 * Identity is the EMAIL, not a user id, because the email is what the
 * authorization decision was made on (`isAdminEmail`). Comparing ids would
 * compare something the check never consulted.
 */
export function isSelfAction(actorEmail: string, targetEmail: string | null | undefined): boolean {
  if (!targetEmail) return false;
  return actorEmail.trim().toLowerCase() === targetEmail.trim().toLowerCase();
}
