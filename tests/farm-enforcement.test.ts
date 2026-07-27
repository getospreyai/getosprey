// The farm rule after claiming.
//
// This covers a regression Phase 2 introduces rather than a feature it adds.
// withinFarm() is the cost control for the whole agent feature, and before
// Phase 2 it was enforced in two places that were between them sufficient —
// because every agent-sourced buy box was written by the agent. A claimed
// client writes their own through PATCH /api/profile, which never checked.
//
// The two things these tests protect, in order of how badly they would go
// wrong:
//
//   1. A solo investor — every user in the product today — must be completely
//      unaffected. This code runs on their settings save, and the failure mode
//      of getting it wrong is disconnecting agents that do not exist, or
//      worse, refusing saves.
//   2. An out-of-farm move must disconnect rather than be refused or silently
//      allowed. Refusing contradicts what the claim screen promised; allowing
//      it silently is the hole this closes.

import { describe, it, expect } from "vitest";
import { decideFarmOutcome, disconnectNotice, enforceFarmOnBuyBoxWrite } from "@/lib/farm-enforcement";
import type { BuyBox } from "@/osprey/agent/model";
import type { WatchTarget } from "@/osprey/agent/watcher";

const vegas: BuyBox = {
  states: ["NV"],
  cities: ["Las Vegas"],
  propertyTypes: ["single_family"],
};
const honolulu: BuyBox = {
  states: ["HI"],
  cities: ["Honolulu"],
  propertyTypes: ["single_family"],
};

const vegasFarm: WatchTarget[] = [{ city: "Las Vegas", state: "NV" }];

describe("a user with no agent is never touched", () => {
  it("allows any buy box when there is no agent", () => {
    // The path every existing user takes on every settings save.
    expect(decideFarmOutcome({ agentName: null, farm: [] }, honolulu)).toEqual({
      action: "allow",
    });
  });

  it("allows even a buy box that would be out of farm, if there is no agent", () => {
    expect(decideFarmOutcome({ agentName: null, farm: vegasFarm }, honolulu)).toEqual({
      action: "allow",
    });
  });

  it("does not consult the farm at all without an agent", async () => {
    // Guards the ordering: the agent lookup comes first and short-circuits, so
    // a solo investor's save costs one indexed query and nothing else.
    let farmLoaded = false;
    const notice = await enforceFarmOnBuyBoxWrite(
      "u1",
      honolulu,
      {
        loadActiveAgentForClient: async () => null,
        loadFarmMarkets: async () => {
          farmLoaded = true;
          return [];
        },
        disconnectAgent: async () => {
          throw new Error("must not disconnect a user with no agent");
        },
      },
      "TEST",
    );
    expect(notice).toBeNull();
    expect(farmLoaded).toBe(false);
  });
});

describe("a client inside their agent's farm", () => {
  it("is allowed and stays connected", () => {
    expect(decideFarmOutcome({ agentName: "Dana", farm: vegasFarm }, vegas)).toEqual({
      action: "allow",
    });
  });

  it("is allowed when the farm is a whole state covering their city", () => {
    expect(
      decideFarmOutcome({ agentName: "Dana", farm: [{ state: "NV" }] }, vegas),
    ).toEqual({ action: "allow" });
  });
});

describe("a client who moves outside the farm", () => {
  it("is DISCONNECTED, not refused", () => {
    // The whole decision: the write always goes through. The client owns their
    // buy box — the only question is whether the agent comes along.
    const outcome = decideFarmOutcome({ agentName: "Dana", farm: vegasFarm }, honolulu);
    expect(outcome.action).toBe("disconnect");
  });

  it("records a reason naming what happened", () => {
    const outcome = decideFarmOutcome({ agentName: "Dana", farm: vegasFarm }, honolulu);
    expect(outcome.action === "disconnect" && outcome.reason).toContain("outside");
    expect(outcome.action === "disconnect" && outcome.reason).toContain("automatically disconnected");
  });

  it("actually calls disconnect, once, with the recorded reason", async () => {
    const calls: { clientUserId: string; agentUserId: string; reason: string }[] = [];
    const notice = await enforceFarmOnBuyBoxWrite(
      "client-1",
      honolulu,
      {
        loadActiveAgentForClient: async () => ({ agentUserId: "agent-1", agentName: "Dana" }),
        loadFarmMarkets: async () => [{ city: "Las Vegas", state: "NV" }],
        disconnectAgent: async (p) => {
          calls.push({
            clientUserId: p.clientUserId,
            agentUserId: p.agentUserId,
            reason: p.reason,
          });
        },
      },
      "TEST",
    );

    expect(calls).toHaveLength(1);
    expect(calls[0].clientUserId).toBe("client-1");
    expect(calls[0].agentUserId).toBe("agent-1");
    expect(calls[0].reason).toContain("automatically disconnected");
    // The notice is what the client sees, and must come back non-null so the
    // route cannot drop it.
    expect(notice).not.toBeNull();
    expect(notice).toContain("Dana");
  });

  it("tells the client their data is intact", () => {
    // A message that only says "your agent was removed" reads like something
    // broke. The point is that nothing of theirs changed.
    const notice = disconnectNotice("Dana");
    expect(notice).toContain("unchanged");
    expect(notice).toContain("no longer see");
  });
});

describe("the cases that must NOT trigger a disconnect", () => {
  it("an agent who has set no farm markets keeps their clients", () => {
    // An empty farm covers nothing, so withinFarm rejects every buy box.
    // Disconnecting every client of an agent mid-setup would be absurd and
    // destructive. POST /api/clients is where a missing farm gets caught.
    expect(decideFarmOutcome({ agentName: "Dana", farm: [] }, vegas)).toEqual({
      action: "allow",
    });
    expect(decideFarmOutcome({ agentName: "Dana", farm: [] }, honolulu)).toEqual({
      action: "allow",
    });
  });

  it("a buy box with no state is unscannable, not out-of-farm", () => {
    // withinFarm rejects this, but for a different reason — it derives no
    // markets at all. Ending someone's agent relationship over a half-filled
    // form would be a hostile way to find out.
    const noState: BuyBox = { states: [], cities: [], propertyTypes: ["single_family"] };
    expect(decideFarmOutcome({ agentName: "Dana", farm: vegasFarm }, noState)).toEqual({
      action: "allow",
    });
  });

  it("a city-level farm still covers its own city after normalization", () => {
    // Case differences must not read as "left the farm" — a client typing
    // "las vegas" would otherwise silently lose their agent.
    const lower: BuyBox = {
      states: ["nv"],
      cities: ["las vegas"],
      propertyTypes: ["single_family"],
    };
    expect(decideFarmOutcome({ agentName: "Dana", farm: vegasFarm }, lower)).toEqual({
      action: "allow",
    });
  });
});

describe("partial moves", () => {
  it("disconnects when ANY targeted market is outside the farm", () => {
    // Half-in is out. The cost control is per-market: one uncovered market is
    // one extra full paginated RentCast pull, which is the thing being
    // prevented.
    const both: BuyBox = {
      states: ["NV", "HI"],
      cities: ["Las Vegas", "Honolulu"],
      propertyTypes: ["single_family"],
    };
    expect(decideFarmOutcome({ agentName: "Dana", farm: vegasFarm }, both).action).toBe(
      "disconnect",
    );
  });
});
