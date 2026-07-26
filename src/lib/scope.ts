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
//    re-reads agent_clients.

import { sql } from "@/lib/db";

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
  /** False for read-only access. Today an agent may edit a client's buy box
   *  until the relationship is archived; a future "client disconnected but
   *  agent keeps history" state would land here rather than in call sites. */
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

/** Injectable so the decision logic is unit-testable without Postgres. */
export type ClientLinkLookup = (agentUserId: string, clientUserId: string) => Promise<boolean>;

/** Is this client on this agent's active (non-archived) roster? */
const dbClientLink: ClientLinkLookup = async (agentUserId, clientUserId) => {
  if (!sql) return false;
  const rows = (await sql`
    SELECT 1
    FROM agent_clients
    WHERE agent_user_id = ${agentUserId}
      AND client_user_id = ${clientUserId}
      AND archived_at IS NULL
    LIMIT 1
  `) as unknown[];
  return rows.length > 0;
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
  lookup: ClientLinkLookup = dbClientLink,
): Promise<Scope | null> {
  if (!viewerId) return null;

  // Default to self. An explicit id equal to the viewer's is the same case.
  if (!requestedSubjectId || requestedSubjectId === viewerId) {
    return {
      viewerId,
      subjectId: viewerId as SubjectId,
      relation: "self",
      canEdit: true,
    };
  }

  const linked = await lookup(viewerId, requestedSubjectId);
  if (!linked) return null;

  return {
    viewerId,
    subjectId: requestedSubjectId as SubjectId,
    relation: "agent_of_client",
    canEdit: true,
  };
}
