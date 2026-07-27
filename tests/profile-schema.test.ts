// setUpByAgent is a server-controlled field on a user-editable object, which
// is a shape that goes wrong quietly. These tests pin both halves of why it
// cannot be written by a client.
//
// Why it matters: the label backs a claim about provenance. If a user can set
// it, an ordinary self-serve buy box can be made to say an agent configured
// it. If a user can clear it, the provenance the label exists to show
// disappears on the next settings save — silently, because nothing else in the
// system reads the field.

import { describe, it, expect } from "vitest";
import { PatchProfileSchema, mergeProfileSettings } from "@/lib/profile-schema";
import type { InvestorProfile } from "@/osprey/agent/model";

/** A minimal valid settings payload. */
const validPatch = {
  buyBox: {
    cities: ["Las Vegas"],
    states: ["NV"],
    minPrice: null,
    maxPrice: null,
    propertyTypes: ["single_family" as const],
    maxDaysOnMarket: null,
  },
  minMonthlyCashFlow: 250,
  alertsPaused: false,
  financingProfiles: [
    // Rates and percentages are decimals here — 0.0675 is 6.75%.
    { kind: "conventional" as const, label: "Conventional", rate: 0.0675, downPct: 0.2 },
  ],
};

function storedProfile(over: Partial<InvestorProfile> = {}): InvestorProfile {
  return {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Client",
    buyBox: { states: ["NV"], cities: ["Las Vegas"], propertyTypes: ["single_family"] },
    financingProfiles: [],
    minMonthlyCashFlow: 0,
    onboarded: true,
    ...over,
  };
}

describe("setUpByAgent cannot be written by a client", () => {
  it("zod strips it from an incoming payload", () => {
    const parsed = PatchProfileSchema.safeParse({
      ...validPatch,
      setUpByAgent: true,
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && "setUpByAgent" in parsed.data).toBe(false);
  });

  it("a payload claiming setUpByAgent does not set it on a self-serve profile", () => {
    const parsed = PatchProfileSchema.parse({ ...validPatch, setUpByAgent: true });
    const merged = mergeProfileSettings(storedProfile(), parsed);
    expect(merged.setUpByAgent).toBeUndefined();
  });

  it("a payload claiming setUpByAgent: false does not clear a real one", () => {
    const parsed = PatchProfileSchema.parse({ ...validPatch, setUpByAgent: false });
    const merged = mergeProfileSettings(storedProfile({ setUpByAgent: true }), parsed);
    expect(merged.setUpByAgent).toBe(true);
  });

  it("survives an ordinary settings save that does not mention it", () => {
    const parsed = PatchProfileSchema.parse(validPatch);
    const merged = mergeProfileSettings(storedProfile({ setUpByAgent: true }), parsed);
    expect(merged.setUpByAgent).toBe(true);
  });

  it("survives a save that rewrites every editable field", () => {
    // The realistic path to losing it: someone rebuilds mergeProfileSettings
    // to construct a fresh object instead of spreading `stored`.
    const parsed = PatchProfileSchema.parse({
      ...validPatch,
      minMonthlyCashFlow: 999,
      alertsPaused: true,
      buyBox: { ...validPatch.buyBox, cities: ["Reno"], propertyTypes: ["duplex" as const] },
    });
    const merged = mergeProfileSettings(storedProfile({ setUpByAgent: true }), parsed);
    expect(merged.setUpByAgent).toBe(true);
    expect(merged.minMonthlyCashFlow).toBe(999);
    expect(merged.buyBox.cities).toEqual(["Reno"]);
  });
});

describe("the other server-controlled fields are still protected", () => {
  it("does not let a payload rewrite id, name, onboarded, or telegramChatId", () => {
    const parsed = PatchProfileSchema.parse({
      ...validPatch,
      id: "99999999-9999-4999-8999-999999999999",
      name: "Someone Else",
      onboarded: false,
      telegramChatId: 12345,
    });
    const stored = storedProfile({ telegramChatId: 777 });
    const merged = mergeProfileSettings(stored, parsed);

    expect(merged.id).toBe(stored.id);
    expect(merged.name).toBe("Client");
    expect(merged.onboarded).toBe(true);
    expect(merged.telegramChatId).toBe(777);
  });
});
