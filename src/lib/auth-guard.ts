// Who is allowed to authenticate at all.
//
// Agent accounts introduce user rows that deliberately CANNOT log in: a
// `managed` (or `invited`) client is a real users row so that every per-user
// table keeps working, but it has no password — the agent maintains its buy box
// until the client claims the account.
//
// That makes `password_hash` nullable, which is load-bearing for security:
// verified empirically against a Neon branch (2026-07-26), bcryptjs does NOT
// safely reject a null digest —
//
//     bcrypt.compare("anything", null)      -> THROWS "Illegal arguments: string, object"
//     bcrypt.compare("anything", undefined) -> THROWS "Illegal arguments: string, undefined"
//     bcrypt.compare("anything", "")        -> returns false
//
// So reaching bcrypt.compare with a managed client's null hash raises inside
// authorize() instead of cleanly denying. This guard runs BEFORE the compare.

export interface AuthCandidate {
  password_hash: string | null;
  /** 'active' | 'managed' | 'invited'. May be undefined on a query that
   *  predates the column — the hash check below is the authoritative control,
   *  so an unknown status is not by itself treated as a denial. */
  status?: string | null;
}

/**
 * Whether an account may act at all — hold a session, or be the viewer on a
 * request.
 *
 * ALLOWLIST, deliberately. An earlier version denied a fixed set
 * ('managed', 'invited'), which failed OPEN: a typo ('manged'), or any status
 * added later ('suspended', 'disabled'), fell through as permitted. Only
 * 'active' is permitted now.
 *
 * A null/undefined status is tolerated for a row read by a query that does not
 * select the column; the database column is NOT NULL DEFAULT 'active', so no
 * stored row is actually statusless.
 */
export function canActAsViewer(status?: string | null): boolean {
  return status == null || status === "active";
}

/**
 * Whether this row may attempt password authentication.
 *
 * Two independent reasons to refuse, deliberately redundant:
 *  1. No usable password hash. Airtight by construction — managed and invited
 *     clients are created with NULL — and it is what keeps bcrypt.compare from
 *     ever seeing a non-string.
 *  2. A status that is not 'active', in case a row ever acquires a hash it
 *     should not have.
 */
export function canAuthenticate(user: AuthCandidate): boolean {
  if (typeof user.password_hash !== "string" || user.password_hash.length === 0) return false;
  if (!canActAsViewer(user.status)) return false;
  return true;
}
