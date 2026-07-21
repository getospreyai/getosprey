// Binary-search solvers over the underwriting engine, plus a rent-stress
// helper. Pure engine code — no store/env imports — so every export here is
// exercisable with fixture data.

import { underwrite } from './underwrite';
import type { Assumptions, FinancingProfile, IncomeInput, PropertyInput } from './types';

export interface SolverInput {
  property: PropertyInput;
  income: IncomeInput;
  financing: FinancingProfile;
  assumptions?: Partial<Assumptions>;
  /** The investor's alert bar (minMonthlyCashFlow). solveClearingRate reuses
   *  this same field: there it's still "the cash-flow bar to clear," just
   *  solved for by varying rate instead of price. */
  targetMonthlyCashFlow: number;
}

export interface MaxOfferResult {
  /** Whether cash flow at the listing's actual asking price already clears the bar. */
  clearsAtAsk: boolean;
  /** The highest price that still clears the bar, rounded to the nearest $500. */
  maxPrice: number;
  /** (maxPrice - ask) / ask * 100 — negative when maxPrice sits below ask. */
  pctVsAsk: number;
  /** Cash flow at the actual ask price, for display alongside the solve. */
  cashFlowAtAsk: number;
}

const SEARCH_ITERATIONS = 40;
const PRICE_ROUND = 500;
const RATE_FLOOR = 0.005;
const RATE_CEILING = 0.15;
const RATE_ROUND = 0.0005; // 5bps

function cashFlowAt(price: number, input: SolverInput): number {
  // Spreading `price` over the original property leaves annualTaxes/
  // annualInsurance untouched when the listing carries real assessed
  // figures — they're fixed dollar amounts, not a function of the offer.
  // When they're absent, underwrite()'s own price * rate fallback moves
  // naturally with the hypothetical price. No special-casing needed here.
  const uw = underwrite({
    property: { ...input.property, price },
    income: input.income,
    financing: input.financing,
    assumptions: input.assumptions,
  });
  return uw.monthlyCashFlow;
}

function roundToStep(value: number, step: number): number {
  const rounded = Math.round(value / step) * step;
  // Clean up float noise (e.g. 0.0675 landing as 0.06750000000000001).
  return Math.round(rounded * 1e6) / 1e6;
}

/**
 * Highest price that still clears `targetMonthlyCashFlow`, binary-searched
 * on [0.4x, 1.6x] of the listing's ask price. Cash flow is monotonic-
 * decreasing in price (bigger loan and/or bigger price-derived tax/insurance
 * estimate), so a standard bisection applies.
 *
 * Returns null when even the search floor (0.4x ask) can't clear — the rent
 * is fundamentally too low for this financing/target combination, financed
 * or cash. Clamps to the search ceiling (1.6x ask) rather than extrapolating
 * past a range we trust when the deal clears even there.
 */
export function solveMaxOffer(input: SolverInput): MaxOfferResult | null {
  const ask = input.property.price;
  if (!(ask > 0)) return null;

  const cashFlowAtAsk = cashFlowAt(ask, input);
  const clearsAtAsk = cashFlowAtAsk >= input.targetMonthlyCashFlow;

  let lo = ask * 0.4;
  let hi = ask * 1.6;
  const cfLo = cashFlowAt(lo, input);
  const cfHi = cashFlowAt(hi, input);

  if (cfLo < input.targetMonthlyCashFlow) return null;

  let maxPrice: number;
  if (cfHi >= input.targetMonthlyCashFlow) {
    // Clears even at the top of the search band — cap there rather than
    // extrapolating past a range we trust.
    maxPrice = hi;
  } else {
    for (let i = 0; i < SEARCH_ITERATIONS; i++) {
      const mid = (lo + hi) / 2;
      if (cashFlowAt(mid, input) >= input.targetMonthlyCashFlow) {
        lo = mid;
      } else {
        hi = mid;
      }
    }
    maxPrice = lo;
  }

  maxPrice = Math.round(maxPrice / PRICE_ROUND) * PRICE_ROUND;
  return {
    clearsAtAsk,
    maxPrice,
    pctVsAsk: ((maxPrice - ask) / ask) * 100,
    cashFlowAtAsk,
  };
}

/**
 * Rate at which cash flow at the listing's ACTUAL ask price clears
 * `targetMonthlyCashFlow`, binary-searched on [0.5%, 15%]. Financed profiles
 * only — a cash purchase has no rate to solve for. Null when no rate in the
 * band clears (the deal doesn't work even at the friendliest rate). Clamps
 * to the band's ceiling rather than extrapolating past it when the deal
 * clears even at the worst rate in band.
 */
export function solveClearingRate(input: SolverInput): number | null {
  const { property, income, financing, assumptions, targetMonthlyCashFlow } = input;
  if (financing.kind === 'cash') return null;

  const cashFlowAtRate = (rate: number): number => {
    const uw = underwrite({
      property,
      income,
      financing: { ...financing, rate },
      assumptions,
    });
    return uw.monthlyCashFlow;
  };

  let lo = RATE_FLOOR;
  let hi = RATE_CEILING;
  const cfLo = cashFlowAtRate(lo);
  const cfHi = cashFlowAtRate(hi);

  if (cfLo < targetMonthlyCashFlow) return null;
  if (cfHi >= targetMonthlyCashFlow) return roundToStep(hi, RATE_ROUND);

  for (let i = 0; i < SEARCH_ITERATIONS; i++) {
    const mid = (lo + hi) / 2;
    if (cashFlowAtRate(mid) >= targetMonthlyCashFlow) {
      lo = mid;
    } else {
      hi = mid;
    }
  }
  return roundToStep(lo, RATE_ROUND);
}

export interface StressResult {
  /** Monthly cash flow using the AVM's low-end rent estimate. */
  lowEndCashFlow: number;
  /** Whether that low-end cash flow still clears the bar. */
  holdsAtLowEnd: boolean;
}

/**
 * Re-underwrites at the AVM's rentRangeLow instead of the point estimate —
 * "if the rent comes in at the pessimistic end of the range, does this deal
 * still work?" Null when the income basis has no range (e.g. actual leases,
 * or an AVM estimate that came back without a low end).
 */
export function stressAtRangeLow(input: {
  property: PropertyInput;
  income: IncomeInput;
  financing: FinancingProfile;
  assumptions?: Partial<Assumptions>;
  bar: number;
}): StressResult | null {
  const rangeLow = input.income.rent.rangeLow;
  if (rangeLow == null) return null;

  const uw = underwrite({
    property: input.property,
    income: {
      ...input.income,
      rent: { ...input.income.rent, monthlyRent: rangeLow, source: 'avm_estimate' },
    },
    financing: input.financing,
    assumptions: input.assumptions,
  });

  return {
    lowEndCashFlow: uw.monthlyCashFlow,
    holdsAtLowEnd: uw.monthlyCashFlow >= input.bar,
  };
}
