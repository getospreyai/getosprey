import type { Assumptions, PropertyType } from './types';

// Industry-standard operating assumptions, aligned with what the leading
// deal-analysis tools (DealCheck, BiggerPockets calculators) use as their
// conventional starting points. Every value is overridable per user/profile.
export const STANDARD_ASSUMPTIONS: Assumptions = {
  vacancyPct: 0.05, // 5% floor; 5–10% is the accepted range
  maintenancePct: 0.05, // % of gross rent
  capexPct: 0.05, // % of gross rent
  managementPct: 0.08, // 8–12% of collected income is typical
  purchaseClosingPct: 0.03,
  sellingCostPct: 0.07, // commissions + seller closing at exit
  utilitiesMonthly: 0,
  otherMonthlyExpense: 0,
  taxRatePct: 0.01, // national fallback; override per market (NV ≈ 0.006)
  insuranceRatePct: 0.0035,
  annualAppreciationPct: 0.03,
  annualIncomeGrowthPct: 0.02,
  annualExpenseGrowthPct: 0.02,
};

export const UNITS_BY_TYPE: Record<PropertyType, number> = {
  single_family: 1,
  duplex: 2,
  triplex: 3,
  fourplex: 4,
};

// Financing product defaults.
export const FHA_DEFAULTS = {
  downPct: 0.035,
  ufmipPct: 0.0175,
  annualMipPct: 0.0055,
  termYears: 30,
};

export const CONVENTIONAL_DEFAULTS = {
  pmiAnnualPct: 0.006, // applied while LTV > 80%
  termYears: 30,
};

export const DSCR_DEFAULTS = {
  minDscr: 1.0, // lender floor; 1.25+ unlocks best pricing
  termYears: 30,
};
