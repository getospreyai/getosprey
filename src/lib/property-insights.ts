// Server-side "rent transparency + max offer" bundle shared by the property
// page, the public share page, and the lender packet PDF route — one call
// site for the solver/stress/Section-8/comps math instead of tripling it.
// Pure composition of already-exported engine functions; no engine/store
// internals touched.

import {
  section8Standard,
  solveClearingRate,
  solveMaxOffer,
  stressAtRangeLow,
  type IncomeInput,
  type MaxOfferResult,
  type PropertyInput,
  type Section8Standard,
  type StressResult,
  type Underwriting,
} from "@/osprey/engine";
import { topComparables, type RentComparable } from "@/lib/rent-comparables";

export interface PropertyInsights {
  maxOffer: MaxOfferResult | null;
  clearingRate: number | null;
  stress: StressResult | null;
  section8: Section8Standard | null;
  comparables: RentComparable[];
}

export function computePropertyInsights(params: {
  property: PropertyInput;
  income: IncomeInput;
  /** The underwriting already selected for display (bestUnderwriting's pick) —
   *  its financing + resolved assumptions are what the solver runs against. */
  uw: Underwriting;
  /** The investor's alert bar (minMonthlyCashFlow) — the solver's target. */
  bar: number;
  bedrooms?: number;
  rawComparables?: unknown[];
}): PropertyInsights {
  const { property, income, uw, bar } = params;

  const solverInput = {
    property,
    income,
    financing: uw.financing,
    assumptions: uw.assumptions,
    targetMonthlyCashFlow: bar,
  };

  return {
    maxOffer: solveMaxOffer(solverInput),
    clearingRate: solveClearingRate(solverInput),
    stress: stressAtRangeLow({ property, income, financing: uw.financing, assumptions: uw.assumptions, bar }),
    section8:
      params.bedrooms != null ? section8Standard(params.bedrooms, property.state, property.city) : null,
    comparables: topComparables(params.rawComparables),
  };
}

/** Same [0.03, profileRate) gate verdict.ts's private MAX OFFER block uses
 *  for its clearing-rate line (that helper isn't exported, so this is a
 *  deliberate duplicate of the threshold, not the text) — keeps the UI card
 *  and the packet PDF agreeing with the SMS/analysis text about when a
 *  solved rate is worth showing at all. */
export function showClearingRateLine(
  clearingRate: number | null,
  profileRate: number,
): clearingRate is number {
  return clearingRate != null && clearingRate >= 0.03 && clearingRate < profileRate;
}
