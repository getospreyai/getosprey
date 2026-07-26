// isScannable() was extracted verbatim from the cron route's inline filter.
// The first block below is an EQUIVALENCE PROOF: it re-states the original
// predicate and asserts the extracted one agrees across every combination of
// the three inputs it reads. If someone later "improves" isScannable and
// changes which profiles the daily scan considers, this fails.
//
// The remaining blocks pin the reason codes, which the client roster UI will
// render so an agent can see WHY a client isn't scanning instead of silence.

import { describe, it, expect } from "vitest";
import { isScannable, scannableProfiles } from "@/osprey/agent/scannable";
import type { InvestorProfile } from "@/osprey/agent/model";
import type { FinancingProfile, PropertyType } from "@/osprey/engine";

const CASH: FinancingProfile = { kind: "cash" };

function profile(over: Partial<InvestorProfile> = {}): InvestorProfile {
  return {
    id: "u1",
    name: "Test Investor",
    buyBox: { propertyTypes: ["fourplex"], states: ["NV"] },
    financingProfiles: [CASH],
    minMonthlyCashFlow: 250,
    ...over,
  };
}

/** The predicate exactly as it read inline in src/app/api/cron/scan/route.ts. */
function originalInlineFilter(p: InvestorProfile): boolean {
  return (
    p.onboarded !== false &&
    p.financingProfiles.length > 0 &&
    p.buyBox.propertyTypes.length > 0
  );
}

describe("isScannable — equivalence with the original inline cron filter", () => {
  const onboardedValues: (boolean | undefined)[] = [true, false, undefined];
  const financingValues: FinancingProfile[][] = [[], [CASH]];
  const typeValues: PropertyType[][] = [[], ["fourplex"], ["duplex", "triplex"]];

  for (const onboarded of onboardedValues) {
    for (const financingProfiles of financingValues) {
      for (const propertyTypes of typeValues) {
        const label =
          `onboarded=${String(onboarded)} ` +
          `financing=${financingProfiles.length} types=${propertyTypes.length}`;

        it(`agrees for ${label}`, () => {
          const p = profile({
            onboarded,
            financingProfiles,
            buyBox: { propertyTypes, states: ["NV"] },
          });
          expect(isScannable(p).ok).toBe(originalInlineFilter(p));
        });
      }
    }
  }
});

describe("isScannable — reason codes", () => {
  it("passes a fully configured profile", () => {
    expect(isScannable(profile())).toEqual({ ok: true });
  });

  // Legacy/CLI profiles predate the flag and must keep scanning. Tightening
  // this to `onboarded === true` would silently drop them.
  it("treats undefined onboarded as onboarded", () => {
    expect(isScannable(profile({ onboarded: undefined })).ok).toBe(true);
  });

  it("blocks mid-wizard profiles", () => {
    const r = isScannable(profile({ onboarded: false }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("onboarding_incomplete");
  });

  it("blocks profiles with no financing", () => {
    const r = isScannable(profile({ financingProfiles: [] }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("no_financing");
  });

  it("blocks profiles with no property types", () => {
    const r = isScannable(profile({ buyBox: { propertyTypes: [] } }));
    expect(r.ok).toBe(false);
    expect(r.ok === false && r.code).toBe("no_property_types");
  });

  it("always supplies a human-readable reason when blocked", () => {
    for (const p of [
      profile({ onboarded: false }),
      profile({ financingProfiles: [] }),
      profile({ buyBox: { propertyTypes: [] } }),
    ]) {
      const r = isScannable(p);
      expect(r.ok).toBe(false);
      expect(r.ok === false && r.reason.length).toBeGreaterThan(0);
    }
  });
});

describe("scannableProfiles", () => {
  it("keeps only scannable profiles and preserves order", () => {
    const ok1 = profile({ id: "ok1" });
    const bad = profile({ id: "bad", onboarded: false });
    const ok2 = profile({ id: "ok2" });
    expect(scannableProfiles([ok1, bad, ok2]).map((p) => p.id)).toEqual(["ok1", "ok2"]);
  });

  // The trap agent accounts must avoid: an agent-created client profile that
  // leaves onboarded=false never scans, forever, with no error anywhere.
  it("excludes an agent-created client left mid-setup", () => {
    expect(scannableProfiles([profile({ id: "client", onboarded: false })])).toEqual([]);
  });
});
