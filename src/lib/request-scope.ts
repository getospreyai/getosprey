// The single entry point request handlers use to get an authorized store.
//
// Replaces the old pattern of reading `session.user.id` and handing it to a
// raw PgStore. What comes back is a ScopedStore whose subject is already
// checked and bound, so the handler has no user id to pass and therefore no
// user id to get wrong.
//
// Every caller must handle `ok: false`. The reasons are deliberately distinct
// for the CALLER's benefit, not the client's — see the note on `forbidden`.

import { auth } from "@/auth";
import { hasDb } from "@/lib/db";
import { resolveScope, type Scope } from "@/lib/scope";
import { scopedStore, type ScopedStore } from "@/lib/scoped-store";

export type ScopeResult =
  | {
      ok: true;
      store: ScopedStore;
      scope: Scope;
      /** The signed-in user (the actor), NOT necessarily the subject. */
      userId: string;
      userName: string;
    }
  | { ok: false; reason: "unauthenticated" }
  | { ok: false; reason: "no_db"; userName: string }
  | { ok: false; reason: "forbidden"; userName: string };

/**
 * Resolve the acting scope for the current request.
 *
 * Omit `clientId` for "acting as myself" — which is every caller today. Pass it
 * only from a route that genuinely takes a client parameter; it is
 * attacker-controlled and is validated against the roster by resolveScope.
 *
 * On `forbidden`, respond exactly as you would for a nonexistent resource
 * (404, or the same empty state), never with a distinct "not allowed" message:
 * a 403-vs-404 split turns any such route into a user-enumeration oracle
 * (docs/AGENT-ACCOUNTS-PLAN.md §3a, T4). Today `forbidden` can only mean the
 * viewer's own account was deleted or suspended after their JWT was issued,
 * since no route accepts a client id yet.
 */
export async function resolveRequestScope(clientId?: string | null): Promise<ScopeResult> {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) return { ok: false, reason: "unauthenticated" };

  const userName = session.user.name ?? "there";
  if (!hasDb()) return { ok: false, reason: "no_db", userName };

  const scope = await resolveScope(userId, clientId);
  if (!scope) return { ok: false, reason: "forbidden", userName };

  return { ok: true, store: scopedStore(scope), scope, userId, userName };
}
