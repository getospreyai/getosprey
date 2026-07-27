// Disconnect yourself from your agent.
//
// Required by docs/AGENT-ACCOUNTS-PLAN.md §7: "an `active` client needs a
// disconnect from agent path." §3b lists it among the rights we honor, and the
// consent screen at claim time promises it in as many words — so if this route
// stops working, the disclosure recorded in client_consents becomes false.
//
// The actor here is the CLIENT acting on themselves, so the scope is self and
// no clientId is accepted. An agent cannot call this to drop a client; that is
// archiving, a different operation with a different audit meaning, and letting
// one route do both would make the consent ledger ambiguous about who ended
// the relationship.
//
// The enforcement is entirely pre-existing: resolveScope() refuses the moment
// agent_clients.archived_at is set (src/lib/scope.ts), which is threat T8
// handled by code that shipped in Phase 0. All this route does is set it.

import { NextResponse } from "next/server";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { POLICY_VERSION } from "@/lib/legal";
import { PgStore } from "@/osprey/pg-store";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

/** Written to client_consents.disclosure on the withdrawal row. The ledger is
 *  append-only, so this is the permanent record of WHY access ended. */
const REASON_SELF_SERVE =
  "Client disconnected from their agent from Settings. Agent access to buy box, financing, verdict feed, and property files ended at this time.";

export async function POST() {
  if (!agentAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }

  // No clientId argument, deliberately: this only ever acts on the caller.
  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  // Defensive: resolveRequestScope() with no argument always returns self.
  // If that ever changes, disconnecting the wrong person is the failure, so
  // refuse rather than trust it.
  if (scoped.scope.relation !== "self") {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }

  const store = new PgStore();
  const agent = await store.loadActiveAgentForClient(scoped.userId);

  // Already disconnected, or never had an agent. Idempotent by design — a
  // double-click must not write a second withdrawal row into an append-only
  // ledger, which would read as two separate disconnections.
  if (!agent) {
    return NextResponse.json({ ok: true, alreadyDisconnected: true }, NO_STORE);
  }

  try {
    await store.disconnectAgent({
      clientUserId: scoped.userId,
      agentUserId: agent.agentUserId,
      policyVersion: POLICY_VERSION,
      reason: REASON_SELF_SERVE,
    });
  } catch (err) {
    console.error("Disconnect from agent failed:", err);
    return NextResponse.json(
      { error: "Couldn't disconnect right now. Please try again." },
      { status: 500, ...NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, agentName: agent.agentName }, NO_STORE);
}
