// Characterization tests for market derivation — the scan's cost driver.
//
// Why this matters for agent accounts: the cron derives one scan target per
// distinct market across ALL profiles, then TRUNCATES to OSPREY_MAX_MARKETS
// (default 5) with only a console.warn. Today, with a handful of solo users,
// that cap is never hit. The moment one agent has 50 clients, markets past the
// cap are dropped and those clients silently never get scanned.
//
// These tests pin the derivation + ordering guarantees the cap depends on:
// order is FIRST-SEEN and deterministic, which is the only reason truncation is
// predictable at all. Anything that perturbs ordering changes which clients go
// dark — so it must break a test here first.

import { describe, it, expect } from "vitest";
import {
  buyBoxTargetsMarket,
  capMarkets,
  deriveMarkets,
  marketLabel,
} from "@/osprey/agent/watcher";
import type { BuyBox } from "@/osprey/agent/model";

const box = (over: Partial<BuyBox> = {}): { buyBox: BuyBox } => ({
  buyBox: { propertyTypes: ["fourplex"], ...over },
});

describe("deriveMarkets", () => {
  it("expands cities x states per profile", () => {
    expect(deriveMarkets([box({ states: ["NV"], cities: ["Las Vegas", "Henderson"] })])).toEqual([
      { city: "Las Vegas", state: "NV" },
      { city: "Henderson", state: "NV" },
    ]);
  });

  it("a state with no cities becomes one whole-state target", () => {
    expect(deriveMarkets([box({ states: ["NV"] })])).toEqual([{ state: "NV" }]);
    expect(deriveMarkets([box({ states: ["NV"], cities: [] })])).toEqual([{ state: "NV" }]);
  });

  it("dedupes case-insensitively across profiles", () => {
    const markets = deriveMarkets([
      box({ states: ["NV"], cities: ["Las Vegas"] }),
      box({ states: ["nv"], cities: ["las vegas"] }),
    ]);
    expect(markets).toHaveLength(1);
    expect(markets[0].state).toBe("NV");
  });

  it("normalizes state to upper case but preserves first-seen city casing", () => {
    expect(deriveMarkets([box({ states: ["nv"], cities: ["las vegas"] })])).toEqual([
      { city: "las vegas", state: "NV" },
    ]);
  });

  it("contributes nothing for a profile with no state (RentCast needs one)", () => {
    expect(deriveMarkets([box({ cities: ["Las Vegas"] })])).toEqual([]);
    expect(deriveMarkets([box()])).toEqual([]);
  });

  // The cap (markets.slice(0, OSPREY_MAX_MARKETS)) is only safe to reason about
  // because this order is stable. If this breaks, truncation becomes arbitrary
  // and which clients go dark changes run to run.
  it("returns markets in deterministic first-seen order", () => {
    const profiles = [
      box({ states: ["NV"], cities: ["Las Vegas"] }),
      box({ states: ["AZ"], cities: ["Phoenix"] }),
      box({ states: ["TX"], cities: ["Austin"] }),
    ];
    const once = deriveMarkets(profiles);
    expect(once.map(marketLabel)).toEqual(["Las Vegas, NV", "Phoenix, AZ", "Austin, TX"]);
    expect(deriveMarkets(profiles)).toEqual(once);
  });

  it("grows one market per distinct client market — the cost driver", () => {
    // Stand-in for one agent's client book spread across many metros.
    const clients = ["Las Vegas", "Henderson", "Reno", "Sparks", "Mesquite", "Elko"].map((city) =>
      box({ states: ["NV"], cities: [city] }),
    );
    expect(deriveMarkets(clients)).toHaveLength(6);
  });
});

describe("capMarkets — the silent-starvation guard", () => {
  const m = (state: string): { state: string } => ({ state });
  const five = [m("NV"), m("AZ"), m("TX"), m("CA"), m("UT")];

  it("returns everything and drops nothing when under the cap", () => {
    expect(capMarkets(five, 10)).toEqual({ scanned: five, dropped: [] });
  });

  it("returns everything when exactly at the cap", () => {
    expect(capMarkets(five, 5)).toEqual({ scanned: five, dropped: [] });
  });

  it("reports what it dropped instead of discarding it silently", () => {
    const { scanned, dropped } = capMarkets(five, 3);
    expect(scanned.map(marketLabel)).toEqual(["NV", "AZ", "TX"]);
    expect(dropped.map(marketLabel)).toEqual(["CA", "UT"]);
  });

  it("scanned + dropped always reconstructs the input", () => {
    for (const max of [0, 1, 3, 5, 99]) {
      const { scanned, dropped } = capMarkets(five, max);
      expect([...scanned, ...dropped]).toEqual(five);
    }
  });

  // A negative cap through Array.slice(0, -1) would silently drop from the END
  // — scanning most markets while quietly starving the last. Non-positive and
  // non-finite values mean "no cap", never a partial slice.
  it("treats non-positive and non-finite caps as no cap", () => {
    for (const max of [0, -1, -5, NaN, Infinity]) {
      expect(capMarkets(five, max)).toEqual({ scanned: five, dropped: [] });
    }
  });

  it("handles an empty market list", () => {
    expect(capMarkets([], 5)).toEqual({ scanned: [], dropped: [] });
  });

  it("drops a client's market once the book outgrows the cap", () => {
    // Six client metros against the default cap of 5: one client goes dark.
    const clientMarkets = deriveMarkets(
      ["Las Vegas", "Henderson", "Reno", "Sparks", "Mesquite", "Elko"].map((city) =>
        box({ states: ["NV"], cities: [city] }),
      ),
    );
    const { dropped } = capMarkets(clientMarkets, 5);
    expect(dropped.map(marketLabel)).toEqual(["Elko, NV"]);
  });
});

describe("marketLabel", () => {
  it("renders city+state, or bare state for a whole-state target", () => {
    expect(marketLabel({ city: "Las Vegas", state: "NV" })).toBe("Las Vegas, NV");
    expect(marketLabel({ state: "NV" })).toBe("NV");
  });
});

describe("buyBoxTargetsMarket", () => {
  it("matches a city box to its own city market", () => {
    expect(
      buyBoxTargetsMarket({ propertyTypes: [], states: ["NV"], cities: ["Las Vegas"] }, {
        city: "Las Vegas",
        state: "NV",
      }),
    ).toBe(true);
  });

  it("rejects a different state or city", () => {
    const b: BuyBox = { propertyTypes: [], states: ["NV"], cities: ["Las Vegas"] };
    expect(buyBoxTargetsMarket(b, { city: "Phoenix", state: "AZ" })).toBe(false);
    expect(buyBoxTargetsMarket(b, { city: "Henderson", state: "NV" })).toBe(false);
  });

  it("a whole-state box matches every city market in that state", () => {
    expect(
      buyBoxTargetsMarket({ propertyTypes: [], states: ["NV"] }, { city: "Henderson", state: "NV" }),
    ).toBe(true);
  });

  it("an unrestricted box matches anything", () => {
    expect(buyBoxTargetsMarket({ propertyTypes: [] }, { city: "Austin", state: "TX" })).toBe(true);
  });
});
