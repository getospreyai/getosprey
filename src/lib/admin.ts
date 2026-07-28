// The operator surface's authorization decision, as pure functions.
//
// Split from the session plumbing (src/lib/require-admin.ts) for the same
// reason scope.ts is split from request-scope.ts: everything here is testable
// without next-auth, a database, or a request. The decision that matters is
// the allowlist match, and tests/admin.test.ts exercises it exhaustively.
//
// WHY AN ENV ALLOWLIST AND NOT `role = 'admin'` (docs/ADMIN-UI-PLAN.md §3):
// a database-writable admin flag makes the highest privilege in the system
// reachable from inside the application. Any SQL-injection path, compromised
// credential, or bug in a future admin mutation could escalate to full admin.
// An env allowlist cannot be escalated from within the app, is revocable
// without a deploy, and leaves no admin flag in the database to leak. The
// cost — adding an admin means an env change — is the right trade at this size.
//
// The allowlist is checked SERVER-SIDE ON EVERY REQUEST against the session's
// email. Never trust the JWT's own claims for this, for the same reason `role`
// is nav-only (AGENT-ACCOUNTS-PLAN.md §3a, T5): a JWT goes stale the moment
// access changes, and revocation that waits for a token to expire is not
// revocation.

export type AdminResult =
  | { ok: true; email: string; userName: string }
  // Both refusals exist for the CALLER's benefit, so a route can tell a
  // sign-in problem from a permission problem in its own logs. Neither may
  // produce a distinguishable RESPONSE — see the note on notFound() below.
  | { ok: false; reason: "unauthenticated" }
  | { ok: false; reason: "not_admin" }
  | { ok: false; reason: "no_db" };

/**
 * The configured operator emails, lower-cased and trimmed.
 *
 * Read on every call rather than cached at module load: an env change should
 * take effect on the next request, not on the next cold start. Revocation is
 * the whole reason this lives in the environment.
 */
export function adminEmails(): string[] {
  return (process.env.OSPREY_ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter((e) => e.length > 0);
}

/**
 * Whether this email is an operator.
 *
 * Case-insensitive on both sides — email addresses are not case-sensitive in
 * the part that matters here, and an allowlist that silently fails on
 * "Dylaan.Cannon@gmail.com" is an allowlist that gets "fixed" by adding a
 * second entry.
 *
 * An empty allowlist matches nobody. That is the correct default: an unset
 * OSPREY_ADMIN_EMAILS must not mean "everyone" or "the first user".
 */
export function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  return adminEmails().includes(email.trim().toLowerCase());
}

// requireAdmin() — the session-bound entry point — lives in
// src/lib/require-admin.ts, because importing next-auth here would make this
// module untestable under vitest.
