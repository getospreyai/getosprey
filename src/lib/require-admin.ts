// The single entry point admin routes use to establish operator access.
//
// Deliberately parallel to src/lib/request-scope.ts: one call, first thing in
// the handler, returning a discriminated result the caller must handle. The
// split from src/lib/admin.ts follows the same line as scope.ts /
// request-scope.ts — the decision is pure and unit-tested there, the session
// lookup is here.
//
// The allowlist is read from the environment on every call and compared to the
// session's email SERVER-SIDE. Never trust a JWT claim beyond the identity it
// establishes: `role` is nav-only for the same reason
// (docs/AGENT-ACCOUNTS-PLAN.md §3a, T5), and an allowlist cached at module load
// would mean revocation waits for a cold start.

import { auth } from "@/auth";
import { hasDb } from "@/lib/db";
import { isAdminEmail, type AdminResult } from "@/lib/admin";

/**
 * Resolve operator access for the current request.
 *
 * **Every admin route must answer a failure with `notFound()` — a 404 —
 * whichever reason came back.** A signed-in non-admin who receives a 403 has
 * learned that an operator surface exists at this path and that they are not on
 * it. A 404 tells them nothing. This is the T4 discipline from
 * AGENT-ACCOUNTS-PLAN.md §3a applied to the surface itself rather than to a
 * user id. The reasons are distinguished for the CALLER's logs, never for the
 * response.
 *
 * Note what is deliberately NOT checked: the actor's `users.status`. Operator
 * access is granted by the environment, not by a database row, so suspending an
 * account is not how you revoke an operator — removing them from
 * OSPREY_ADMIN_EMAILS is, and that takes effect on the next request. Adding a
 * status read here would imply the database can grant or withhold admin, which
 * is exactly the property ADMIN-UI-PLAN.md §3 gives up on purpose.
 */
export async function requireAdmin(): Promise<AdminResult> {
  const session = await auth();
  const email = session?.user?.email;
  if (!email) return { ok: false, reason: "unauthenticated" };
  if (!isAdminEmail(email)) return { ok: false, reason: "not_admin" };
  if (!hasDb()) return { ok: false, reason: "no_db" };
  return { ok: true, email: email.toLowerCase(), userName: session.user?.name ?? "operator" };
}
