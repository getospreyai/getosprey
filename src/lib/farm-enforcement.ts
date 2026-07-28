// What happens when a claimed client moves their buy box outside their
// agent's farm.
//
// THE PROBLEM. withinFarm() is the cost control for the entire agent feature:
// the daily cron derives one scan target per distinct market across all
// profiles, each target is a full paginated RentCast pull (~12-20 calls), and
// OSPREY_MAX_MARKETS caps the total. Before Phase 2 it was enforced in exactly
// two places — POST /api/clients and PATCH /api/agent/settings — and that was
// sufficient, because every agent-sourced buy box was written by the agent.
//
// Claiming breaks that. A claimed client owns their buy box and edits it
// through PATCH /api/profile, where withinFarm was never checked. They can
// move it to Honolulu. Their agent's farm — the whole cost invariant — is
// bypassed, and the failure is silent: capMarkets drops the overflow with a
// console.warn, and while Phase 0 made dropped markets recordable in
// scan_runs.markets_dropped, nobody is alerted.
//
// THE DECISION (Dylan, 2026-07-27). Leaving the farm ends the agent
// relationship, automatically. The alternative — refusing the edit — would
// mean telling a client who was just promised they own their data that they
// may not move their own buy box, contradicting AGENT-ACCOUNTS-PLAN.md §2
// decision 3. Auto-disconnect keeps both the cost invariant and the promise:
// you can go wherever you like, and your agent stops coming with you.
//
// It is also coherent as a privacy story rather than merely as a cost control,
// which is why it is a defensible thing to put in front of a user: leaving the
// area your agent works in is a reasonable moment for the relationship to end.
//
// AND IT MUST NOT BE SILENT. Both sides are told:
//   * the client, in the response to the write that triggered it, so the UI
//     can say what just happened while they are looking at the screen;
//   * the agent, via the archived roster row and its withdrawal record, which
//     /clients surfaces as a "recently disconnected" section rather than the
//     client simply vanishing from their book.

import type { BuyBox } from "@/osprey/agent/model";
import type { WatchTarget } from "@/osprey/agent/watcher";
import { parseFarmMarkets, withinFarm } from "@/lib/farm-markets";

export type FarmOutcome =
  /** No agent relationship, or the buy box is inside the farm. Write proceeds
   *  with no side effect. */
  | { action: "allow" }
  /** The write is allowed AND the agent relationship must end. */
  | { action: "disconnect"; reason: string };

export interface FarmContext {
  /** Null when this user has no active agent — the overwhelmingly common
   *  case, and the one that must cost nothing. */
  agentName: string | null;
  /** The agent's declared farm markets. Empty when they never set any. */
  farm: WatchTarget[];
}

/**
 * Decide what a buy-box write means for the agent relationship.
 *
 * Pure, so every branch is testable without a database — which matters
 * because the expensive branch (disconnect) is the one that is hard to
 * exercise by hand and easy to get subtly wrong.
 *
 * Note what this deliberately does NOT do: reject. It never returns "refuse
 * the write." The client owns their buy box; the only question is whether the
 * agent comes along.
 */
export function decideFarmOutcome(ctx: FarmContext, buyBox: BuyBox): FarmOutcome {
  // No agent, nothing to enforce. Checked first so a solo investor's settings
  // save — every settings save in the product today — does no extra work and
  // cannot be affected by any of the logic below.
  if (!ctx.agentName) return { action: "allow" };

  const check = withinFarm(buyBox, ctx.farm);
  if (check.ok) return { action: "allow" };

  // An agent with NO farm markets set fails withinFarm for every buy box,
  // because an empty farm covers nothing. Disconnecting every client of an
  // agent who has not finished setting up would be absurd and destructive, so
  // treat it as "nothing to enforce yet" — the agent cannot have clients
  // outside a farm that does not exist. POST /api/clients still refuses to
  // create clients until they set one, which is where that gets caught.
  if (ctx.farm.length === 0) return { action: "allow" };

  // A buy box that derives no markets at all (no state) is unscannable rather
  // than out-of-farm. It is already refused elsewhere for that reason, and
  // ending someone's agent relationship over a half-filled form would be a
  // hostile way to find out.
  if (check.uncovered.length === 0) return { action: "allow" };

  return {
    action: "disconnect",
    reason:
      `Client moved their buy box outside their agent's farm markets and was ` +
      `automatically disconnected. ${check.reason}`,
  };
}

/** What the client is told, in the response to their own write. */
export function disconnectNotice(agentName: string): string {
  return (
    `That market is outside ${agentName}'s coverage area, so they've been ` +
    `disconnected from your account. Your buy box, feed, and history are ` +
    `unchanged — ${agentName} can no longer see them.`
  );
}

/**
 * Apply the farm rule to a buy-box write. Call this from EVERY path that can
 * change a buy box, before the write lands.
 *
 * Ordering is deliberate: the disconnect happens BEFORE the profile save, so
 * there is never an instant where an out-of-farm buy box exists under a live
 * agent link. The window would only be milliseconds and the cron is daily, but
 * "only milliseconds" is how the invariant this function exists to protect got
 * lost in the first place.
 *
 * Returns the notice to show the client, or null when nothing happened.
 * Callers must surface a non-null return — a silent disconnect is the one
 * outcome this design rules out.
 */
export async function enforceFarmOnBuyBoxWrite(
  userId: string,
  buyBox: BuyBox,
  store: {
    loadActiveAgentForClient(id: string): Promise<{ agentUserId: string; agentName: string } | null>;
    loadFarmMarkets(agentUserId: string): Promise<unknown[]>;
    disconnectAgent(params: {
      clientUserId: string;
      agentUserId: string;
      policyVersion: string;
      reason: string;
    }): Promise<void>;
  },
  policyVersion: string,
): Promise<string | null> {
  const agent = await store.loadActiveAgentForClient(userId);
  // The common case, and the cheap one: no agent, one indexed lookup, done.
  if (!agent) return null;

  const farm = parseFarmMarkets(await store.loadFarmMarkets(agent.agentUserId));
  const outcome = decideFarmOutcome({ agentName: agent.agentName, farm }, buyBox);
  if (outcome.action === "allow") return null;

  await store.disconnectAgent({
    clientUserId: userId,
    agentUserId: agent.agentUserId,
    policyVersion,
    reason: outcome.reason,
  });

  return disconnectNotice(agent.agentName);
}
