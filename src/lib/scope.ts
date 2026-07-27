// Who may act for whom.
//
// Until agent accounts, every user touched only their own rows, so
// authorization was correct by construction. This module is what replaces that
// property: it is the ONLY place that decides a viewer may read or write
// another user's data.
//
// Design notes that matter:
//
//  * `SubjectId` is a branded string. Only resolveScope() and systemSubject()
//    can produce one, so a raw `session.user.id` cannot be passed where a
//    checked subject is required — the compiler rejects it.
//
//  * resolveScope() returns null for BOTH "not your client" and "no such
//    user". Callers must render the same response for either; a 404-vs-403
//    split would let anyone probe which user ids exist (threat T4).
//
//  * The session's `role` claim is never consulted here. It is a sign-in
//    snapshot and goes stale on any role change (threat T5). Every call
//    re-reads the database.
//
//  * The VIEWER is re-validated on every call, not just at sign-in. Sessions
//    are JWTs (auth.ts sets strategy:'jwt'), so they are stateless and cannot
//    be revoked server-side; without this check a deleted or suspended account
//    would keep full access until its token expired.

import { sql } from "@/lib/db";
import { canActAsViewer } from "@/lib/auth-guard";

declare const brand: unique symbol;

/** A user id that has passed an authorization check. Unforgeable by design:
 *  produced only by resolveScope() or systemSubject(). */
export type SubjectId = string & { readonly [brand]: "subject" };

export type Relation = "self" | "agent_of_client";

export interface Scope {
  /** The signed-in user who made the request. */
  viewerId: string;
  /** Whose data this scope authorizes access to. */
  subjectId: SubjectId;
  relation: Relation;
  /**
   * False for read-only access.
   *
   * An agent may edit a client's buy box only while that client is still
   * agent-managed. Once the client CLAIMS their account (status 'active') they
   * own their own data and the agent keeps read access — the commitment made
   * at claim time, recorded in docs/AGENT-ACCOUNTS-PLAN.md §2.
   */
  canEdit: boolean;
}

/**
 * Escape hatch for trusted, non-request contexts — the cron scan and the
 * Telegram webhook, which legitimately act for every user and have no viewer.
 *
 * This is the audit handle for the whole feature: `grep systemSubject`
 * enumerates every authorization bypass in the codebase. Never call it in a
 * path that serves a browser request.
 */
export function systemSubject(id: string): SubjectId {
  return id as SubjectId;
}

/** users.id is a UUID column; anything else cannot identify a user and must
 *  not be handed to Postgres, which raises on a bad cast. */
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isUuid(value: string): boolean {
  return UUID_RE.test(value);
}

/** An active (non-archived) roster row, plus the client's account status. */
export interface ClientLink {
  clientStatus: string | null;
}

/** Injectable so the decision logic is unit-testable without Postgres. */
export interface ScopeDeps {
  /** The viewer's account status, or null when no such user exists. */
  loadViewerStatus(viewerId: string): Promise<{ status: string | null } | null>;
  /** The active roster row for this pair, or null when there isn't one. */
  loadClientLink(agentUserId: string, clientUserId: string): Promise<ClientLink | null>;
}

export const dbScopeDeps: ScopeDeps = {
  async loadViewerStatus(viewerId) {
    if (!sql) return null;
    const rows = (await sql`
      SELECT status FROM users WHERE id = ${viewerId} LIMIT 1
    `) as { status: string | null }[];
    return rows[0] ?? null;
  },

  async loadClientLink(agentUserId, clientUserId) {
    if (!sql) return null;
    // Joining users also proves the client row still exists — an archived
    // relationship and a deleted client are both simply "no row".
    const rows = (await sql`
      SELECT u.status
      FROM agent_clients ac
      JOIN users u ON u.id = ac.client_user_id
      WHERE ac.agent_user_id = ${agentUserId}
        AND ac.client_user_id = ${clientUserId}
        AND ac.archived_at IS NULL
      LIMIT 1
    `) as { status: string | null }[];
    const row = rows[0];
    return row ? { clientStatus: row.status } : null;
  },
};

/**
 * Resolve what `viewerId` may do to `requestedSubjectId`.
 *
 * Omitting the subject means "myself" — the subject is NEVER inferred from
 * anything else, because the caller-supplied id is attacker-controlled
 * (threat T2). Returns null when access is not permitted; callers must treat
 * null as a flat refusal with no detail about why.
 */
export async function resolveScope(
  viewerId: string,
  requestedSubjectId?: string | null,
  deps: ScopeDeps = dbScopeDeps,
): Promise<Scope | null> {
  if (!viewerId) return null;

  // Ids reach here straight from the URL. users.id is UUID, so a malformed
  // value makes Postgres raise on the cast — which surfaced as a 500 and made
  // "not a uuid" distinguishable from "not permitted", the very split T4
  // exists to prevent. Reject the shape here so every unusable id refuses
  // identically.
  if (requestedSubjectId && !isUuid(requestedSubjectId)) return null;
  if (!isUuid(viewerId)) return null;

  // Revocation. A JWT outlives any change to the underlying row, so a viewer
  // that has been deleted, suspended, or converted to an agent-managed account
  // must lose access here rather than at token expiry.
  const viewer = await deps.loadViewerStatus(viewerId);
  if (!viewer || !canActAsViewer(viewer.status)) return null;

  // Default to self. An explicit id equal to the viewer's is the same case.
  if (!requestedSubjectId || requestedSubjectId === viewerId) {
    return {
      viewerId,
      subjectId: viewerId as SubjectId,
      relation: "self",
      canEdit: true,
    };
  }

  const link = await deps.loadClientLink(viewerId, requestedSubjectId);
  if (!link) return null;

  return {
    viewerId,
    subjectId: requestedSubjectId as SubjectId,
    relation: "agent_of_client",
    // A claimed client owns their own data; the agent drops to read-only.
    canEdit: link.clientStatus !== "active",
  };
}
