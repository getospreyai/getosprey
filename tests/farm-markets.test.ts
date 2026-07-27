// Farm markets are the cost control for agent accounts: they are what keeps
// one agent's client book from deriving more scan targets than
// OSPREY_MAX_MARKETS allows, which capMarkets would then silently drop —
// leaving those clients scanned by nobody.
//
// The rejections are the important cases. An over-permissive withinFarm does
// not fail loudly; it fails months later as "why does this client never get
// alerts?"

import { describe, it, expect } from "vitest";
import { farmCovers, parseFarmMarkets, withinFarm } from "@/lib/farm-markets";
import type { BuyBox } from "@/osprey/agent/model";
import type { WatchTarget } from "@/osprey/agent/watcher";

const box = (over: Partial<BuyBox> = {}): BuyBox => ({
  propertyTypes: ["fourplex"],
  ...over,
});

describe("farmCovers", () => {
  it("a city farm covers exactly that city", () => {
    const farm: WatchTarget[] = [{ city: "Las Vegas", state: "NV" }];
    expect(farmCovers(farm, { city: "Las Vegas", state: "NV" })).toBe(true);
    expect(farmCovers(farm, { city: "Henderson", state: "NV" })).toBe(false);
  });

  it("a whole-state farm covers every city in that state", () => {
    const farm: WatchTarget[] = [{ state: "NV" }];
    expect(farmCovers(farm, { city: "Henderson", state: "NV" })).toBe(true);
    expect(farmCovers(farm, { state: "NV" })).toBe(true);
  });

  // The asymmetry that matters: scanning a whole state is strictly more work
  // than the agent declared, so a city farm must NOT authorize it.
  it("a city farm does NOT cover a whole-state target", () => {
    expect(farmCovers([{ city: "Las Vegas", state: "NV" }], { state: "NV" })).toBe(false);
  });

  it("never crosses state lines", () => {
    expect(farmCovers([{ state: "NV" }], { city: "Phoenix", state: "AZ" })).toBe(false);
  });

  it("is case-insensitive on both sides", () => {
    expect(farmCovers([{ city: "las vegas", state: "nv" }], { city: "LAS VEGAS", state: "NV" })).toBe(
      true,
    );
  });
});

describe("withinFarm", () => {
  const farm: WatchTarget[] = [
    { city: "Las Vegas", state: "NV" },
    { city: "Henderson", state: "NV" },
  ];

  it("accepts a client inside the farm", () => {
    expect(withinFarm(box({ states: ["NV"], cities: ["Las Vegas"] }), farm)).toEqual({ ok: true });
  });

  it("accepts a client spanning several farm markets", () => {
    expect(
      withinFarm(box({ states: ["NV"], cities: ["Las Vegas", "Henderson"] }), farm).ok,
    ).toBe(true);
  });

  it("REJECTS a city outside the farm and names it", () => {
    const r = withinFarm(box({ states: ["NV"], cities: ["Reno"] }), farm);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.uncovered.map((m) => m.city)).toEqual(["Reno"]);
    expect(r.ok === false && r.reason).toContain("Reno, NV");
  });

  it("REJECTS when only some of the client's markets are covered", () => {
    const r = withinFarm(box({ states: ["NV"], cities: ["Las Vegas", "Reno"] }), farm);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.uncovered).toHaveLength(1);
  });

  it("REJECTS a whole-state client against a city-only farm", () => {
    expect(withinFarm(box({ states: ["NV"] }), farm).ok).toBe(false);
  });

  it("REJECTS another state entirely", () => {
    expect(withinFarm(box({ states: ["AZ"], cities: ["Phoenix"] }), farm).ok).toBe(false);
  });

  // Without a declared farm there is no cost control, so nothing may be added.
  it("REJECTS everything when the farm is empty", () => {
    const r = withinFarm(box({ states: ["NV"], cities: ["Las Vegas"] }), []);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/farm markets/i);
  });

  // A stateless buy box derives no scan targets at all — accepting it would
  // create exactly the silent never-scanned client this guard prevents.
  it("REJECTS a buy box with no state", () => {
    const r = withinFarm(box({ cities: ["Las Vegas"] }), farm);
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.reason).toMatch(/state/i);
  });
});

describe("parseFarmMarkets", () => {
  it("normalizes state casing and trims", () => {
    expect(parseFarmMarkets([{ city: "  Las Vegas ", state: " nv " }])).toEqual([
      { city: "Las Vegas", state: "NV" },
    ]);
  });

  it("treats a blank city as whole-state", () => {
    expect(parseFarmMarkets([{ city: "   ", state: "NV" }])).toEqual([{ state: "NV" }]);
    expect(parseFarmMarkets([{ state: "NV" }])).toEqual([{ state: "NV" }]);
  });

  it("drops entries with no usable state", () => {
    expect(parseFarmMarkets([{ city: "Las Vegas" }, { state: "" }, {}, null, 7])).toEqual([]);
  });

  it("dedupes case-insensitively", () => {
    expect(
      parseFarmMarkets([
        { city: "Las Vegas", state: "NV" },
        { city: "las vegas", state: "nv" },
      ]),
    ).toHaveLength(1);
  });

  it("returns an empty list for non-array input", () => {
    for (const bad of [null, undefined, "NV", 42, {}]) {
      expect(parseFarmMarkets(bad)).toEqual([]);
    }
  });
});
