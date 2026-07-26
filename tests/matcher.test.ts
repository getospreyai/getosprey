// Characterization tests: these pin down how buy-box matching behaves TODAY,
// before agent/client accounts exist. Once an agent can create client profiles,
// every one of those profiles flows through matchesBuyBox exactly like a solo
// investor's — so a regression here silently changes what every client is
// alerted about. These tests are the tripwire.
//
// Note the deliberate asymmetry captured below: buy-box fields fail CLOSED on
// missing listing data (no state = no match when states are set), while
// dealbreakers fail OPEN (never reject on a field RentCast didn't return).

import { describe, it, expect } from "vitest";
import { matchesBuyBox } from "@/osprey/agent/matcher";
import type { BuyBox, Dealbreakers } from "@/osprey/agent/model";
import type { RentCastListing } from "@/osprey/engine";

/** A listing that matches `baseBox` — override one field per test. */
function listing(over: Partial<RentCastListing> = {}): RentCastListing {
  return {
    id: "L1",
    addressLine1: "1400 Kestrel Hollow Ct",
    city: "Las Vegas",
    state: "NV",
    zipCode: "89135",
    propertyType: "Multi-Family",
    unitCount: 4,
    bedrooms: 8,
    price: 415_000,
    yearBuilt: 1998,
    daysOnMarket: 12,
    ...over,
  };
}

const baseBox: BuyBox = {
  states: ["NV"],
  cities: ["Las Vegas"],
  propertyTypes: ["fourplex"],
};

describe("matchesBuyBox — baseline", () => {
  it("matches a listing squarely inside the box", () => {
    expect(matchesBuyBox(listing(), baseBox)).toBe(true);
  });
});

describe("matchesBuyBox — property type", () => {
  it("rejects a type outside the box", () => {
    expect(
      matchesBuyBox(listing({ propertyType: "Single Family", unitCount: undefined }), baseBox),
    ).toBe(false);
  });

  it("rejects out-of-niche types outright (condo)", () => {
    expect(matchesBuyBox(listing({ propertyType: "Condo" }), baseBox)).toBe(false);
  });

  it("rejects 5+ unit multi-family (outside the niche)", () => {
    expect(matchesBuyBox(listing({ unitCount: 5 }), baseBox)).toBe(false);
  });

  it("maps unitCount to the right multi-family type", () => {
    const box: BuyBox = { ...baseBox, propertyTypes: ["duplex"] };
    expect(matchesBuyBox(listing({ unitCount: 2 }), box)).toBe(true);
    expect(matchesBuyBox(listing({ unitCount: 3 }), box)).toBe(false);
  });
});

describe("matchesBuyBox — price", () => {
  it("rejects a listing with no usable price", () => {
    expect(matchesBuyBox(listing({ price: undefined }), baseBox)).toBe(false);
    expect(matchesBuyBox(listing({ price: 0 }), baseBox)).toBe(false);
  });

  it("honors min/max price bounds inclusively", () => {
    const box: BuyBox = { ...baseBox, minPrice: 400_000, maxPrice: 415_000 };
    expect(matchesBuyBox(listing({ price: 415_000 }), box)).toBe(true);
    expect(matchesBuyBox(listing({ price: 400_000 }), box)).toBe(true);
    expect(matchesBuyBox(listing({ price: 415_001 }), box)).toBe(false);
    expect(matchesBuyBox(listing({ price: 399_999 }), box)).toBe(false);
  });
});

describe("matchesBuyBox — location is case-insensitive", () => {
  it("matches regardless of casing on either side", () => {
    expect(
      matchesBuyBox(listing({ state: "nv", city: "LAS VEGAS" }), {
        ...baseBox,
        states: ["nv"],
        cities: ["las vegas"],
      }),
    ).toBe(true);
  });

  it("rejects a different city or state", () => {
    expect(matchesBuyBox(listing({ city: "Henderson" }), baseBox)).toBe(false);
    expect(matchesBuyBox(listing({ state: "AZ" }), baseBox)).toBe(false);
  });

  it("an empty cities list means the whole state", () => {
    const box: BuyBox = { states: ["NV"], cities: [], propertyTypes: ["fourplex"] };
    expect(matchesBuyBox(listing({ city: "Henderson" }), box)).toBe(true);
  });

  it("fails CLOSED when the listing has no state but the box requires one", () => {
    expect(matchesBuyBox(listing({ state: undefined }), baseBox)).toBe(false);
  });
});

describe("matchesBuyBox — dealbreakers fail OPEN on missing data", () => {
  const box: BuyBox = { ...baseBox };

  it("rejects an HOA above the cap but allows a missing HOA", () => {
    const db: Dealbreakers = { maxHoaMonthly: 100 };
    expect(matchesBuyBox(listing({ hoa: { fee: 250 } }), box, db)).toBe(false);
    expect(matchesBuyBox(listing({ hoa: undefined }), box, db)).toBe(true);
  });

  it("rejects excluded zips but allows a missing zip", () => {
    const db: Dealbreakers = { excludeZips: ["89135"] };
    expect(matchesBuyBox(listing(), box, db)).toBe(false);
    expect(matchesBuyBox(listing({ zipCode: undefined }), box, db)).toBe(true);
  });

  it("rejects too-old builds but allows a missing yearBuilt", () => {
    const db: Dealbreakers = { minYearBuilt: 2000 };
    expect(matchesBuyBox(listing({ yearBuilt: 1998 }), box, db)).toBe(false);
    expect(matchesBuyBox(listing({ yearBuilt: undefined }), box, db)).toBe(true);
  });

  it("allows a listing with no daysOnMarket even when the box caps it", () => {
    const capped: BuyBox = { ...baseBox, maxDaysOnMarket: 5 };
    expect(matchesBuyBox(listing({ daysOnMarket: 12 }), capped)).toBe(false);
    expect(matchesBuyBox(listing({ daysOnMarket: undefined }), capped)).toBe(true);
  });
});
