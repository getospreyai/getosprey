// Curated sample deals for the public /try demo. Only price/rent/propertyType
// are real engine INPUTS here — every figure the page displays (cash flow,
// cap rate, max offer, projection) is computed live by the engine from these
// numbers, never hardcoded, same creed as PhoneDemo's header comment.
// Addresses are illustrative (fictional-but-plausible). Price/rent/type below
// are verified 2026-07-21 to produce the verdicts /try's copy describes — do
// not alter them.

import type { FinancingProfile, IncomeInput, PropertyInput, PropertyType } from "@/osprey/engine";

/** The illustrative monthly cash-flow bar /try shows verdicts against. */
export const DEMO_BAR = 250;

/** Financing every deal loads with before a visitor touches a control. */
export const DEMO_FINANCING: FinancingProfile = {
  kind: "conventional",
  rate: 0.0675,
  downPct: 0.25,
};

export interface DemoDeal {
  id: string;
  city: string;
  state: string;
  address: string;
  propertyType: PropertyType;
  price: number;
  rent: number;
  blurb: string;
}

export const DEMO_DEALS: DemoDeal[] = [
  {
    id: "cleveland",
    city: "Cleveland",
    state: "OH",
    address: "1200 Larchmere Blvd",
    propertyType: "duplex",
    price: 245_000,
    rent: 2_600,
    blurb: "Midwest cash-flow duplex",
  },
  {
    id: "kansas-city",
    city: "Kansas City",
    state: "MO",
    address: "4100 Charlotte St",
    propertyType: "single_family",
    price: 285_000,
    rent: 2_500,
    blurb: "A near-miss worth an offer",
  },
  {
    id: "tampa",
    city: "Tampa",
    state: "FL",
    address: "2015 Palmetto Way",
    propertyType: "triplex",
    price: 480_000,
    rent: 4_400,
    blurb: "Sunbelt multifamily",
  },
];

/** Maps a deal (or the equivalent price/type fields off a validated /api/try
 *  body) to the engine's PropertyInput — the same mapping both call sites
 *  use, so a selected deal and its API round-trip underwrite identically.
 *  address/city/state are carried through for display only; the engine never
 *  reads them. */
export function dealProperty(deal: {
  price: number;
  propertyType: PropertyType;
  address?: string;
  city?: string;
  state?: string;
}): PropertyInput {
  return {
    price: deal.price,
    propertyType: deal.propertyType,
    address: deal.address,
    city: deal.city,
    state: deal.state,
  };
}

/** Maps a deal's rent (or an /api/try body's `rent`) to the engine's
 *  IncomeInput. rangeLow/rangeHigh are a display-only illustrative spread —
 *  underwrite()/solveMaxOffer()/project() all key off monthlyRent alone, so
 *  this doesn't affect any computed figure. */
export function rentIncome(deal: { rent: number }): IncomeInput {
  return {
    rent: {
      monthlyRent: deal.rent,
      source: "avm_estimate",
      rangeLow: Math.round(deal.rent * 0.93),
      rangeHigh: Math.round(deal.rent * 1.07),
    },
  };
}
