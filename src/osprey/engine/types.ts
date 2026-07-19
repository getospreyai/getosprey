// Core domain types for the Osprey underwriting engine.
//
// The engine is financing-agnostic: FHA, conventional, DSCR and cash are all
// first-class FinancingProfile variants. The metric set follows the de-facto
// industry standard for residential deal analysis (cash flow, cap rate, CoC,
// DSCR, GRM, rent-to-value, break-even ratio, rules of thumb, multi-year
// projections with IRR).

export type PropertyType = 'single_family' | 'duplex' | 'triplex' | 'fourplex';

export interface PropertyInput {
  /** Listing/purchase price in dollars. */
  price: number;
  propertyType: PropertyType;
  /** Unit count; derived from propertyType when omitted. */
  units?: number;
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  /** Annual property taxes. When omitted, estimated from price via assumptions.taxRatePct. */
  annualTaxes?: number;
  /** Annual insurance premium. When omitted, estimated from price via assumptions.insuranceRatePct. */
  annualInsurance?: number;
  hoaMonthly?: number;
  squareFeet?: number;
  yearBuilt?: number;
  /** Passthrough identifier from the listing source (e.g. RentCast listing id). */
  sourceId?: string;
}

/** Where the rent number came from — every verdict is labeled with this. */
export type RentSource =
  | 'actual_leases' // rents stated in the listing / rent roll
  | 'listing_remarks' // parsed out of listing description
  | 'avm_estimate' // automated estimate (e.g. RentCast AVM)
  | 'manual'; // user-entered

export interface RentBasis {
  /** Total gross monthly rent for the property. */
  monthlyRent: number;
  /** Per-unit rents when known (length should equal unit count). */
  perUnit?: number[];
  source: RentSource;
  /** Estimate range when the source is an AVM. */
  rangeLow?: number;
  rangeHigh?: number;
  /** Free-text provenance, e.g. "RentCast AVM, 12 comps". */
  note?: string;
}

export interface IncomeInput {
  rent: RentBasis;
  /** Other monthly income (laundry, parking, storage). */
  otherMonthlyIncome?: number;
}

// ---------------------------------------------------------------------------
// Financing profiles
// ---------------------------------------------------------------------------

interface FinancingCommon {
  /** User-facing name, e.g. "My 20% down conventional". */
  label?: string;
  /** Annual interest rate as a decimal, e.g. 0.0675. */
  rate: number;
  termYears?: number; // default 30
}

export interface ConventionalFinancing extends FinancingCommon {
  kind: 'conventional';
  downPct: number; // e.g. 0.20
  /** Annual PMI as % of loan; applied automatically while LTV > 80%. Default 0.006. */
  pmiAnnualPct?: number;
}

export interface FhaFinancing extends FinancingCommon {
  kind: 'fha';
  downPct?: number; // default 0.035
  ufmipPct?: number; // upfront MIP, default 0.0175
  financeUfmip?: boolean; // default true
  annualMipPct?: number; // default 0.0055
  /**
   * FHA requires owner occupancy. When set (1-based unit index), that unit's
   * rent is excluded from qualification math notes; cash-flow verdicts still
   * use full market rent so deals compare consistently across loan types.
   */
  ownerOccupiedUnit?: number;
}

export interface DscrFinancing extends FinancingCommon {
  kind: 'dscr';
  downPct: number; // typically 0.20–0.25
  interestOnly?: boolean;
  /** Lender's minimum DSCR (gross rent / PITIA). Default 1.0; 1.25+ gets best pricing. */
  minDscr?: number;
}

export interface CashFinancing {
  kind: 'cash';
  label?: string;
}

export type FinancingProfile =
  | ConventionalFinancing
  | FhaFinancing
  | DscrFinancing
  | CashFinancing;

// ---------------------------------------------------------------------------
// Assumptions (industry-standard defaults live in defaults.ts)
// ---------------------------------------------------------------------------

export interface Assumptions {
  vacancyPct: number;
  /** Repairs & maintenance, % of gross rent. */
  maintenancePct: number;
  /** Capital expenditure reserve, % of gross rent. */
  capexPct: number;
  /** Property management, % of collected income (EGI). */
  managementPct: number;
  /** Buyer closing costs, % of price. */
  purchaseClosingPct: number;
  /** Selling costs at exit (agent commissions + closing), % of sale price. */
  sellingCostPct: number;
  /** Owner-paid utilities per month. */
  utilitiesMonthly: number;
  otherMonthlyExpense: number;
  /** Fallback annual property-tax rate, % of price, when taxes unknown. */
  taxRatePct: number;
  /** Fallback annual insurance rate, % of price, when premium unknown. */
  insuranceRatePct: number;
  // Growth assumptions for multi-year projections.
  annualAppreciationPct: number;
  annualIncomeGrowthPct: number;
  annualExpenseGrowthPct: number;
}

// ---------------------------------------------------------------------------
// Underwriting output
// ---------------------------------------------------------------------------

export interface LoanBreakdown {
  kind: FinancingProfile['kind'];
  label: string;
  downPayment: number;
  amountFinanced: number;
  ltv: number;
  monthlyPrincipalAndInterest: number;
  /** PMI or FHA MIP. */
  monthlyMortgageInsurance: number;
  /** Upfront fees paid in cash at close (e.g. unfinanced UFMIP). */
  upfrontFeesCash: number;
  interestOnly: boolean;
  termYears: number;
  rate: number;
}

export interface MonthlyCashFlowStatement {
  grossRent: number;
  otherIncome: number;
  vacancyLoss: number;
  effectiveGrossIncome: number;
  expenses: {
    taxes: number;
    insurance: number;
    maintenance: number;
    capex: number;
    management: number;
    utilities: number;
    hoa: number;
    other: number;
    total: number;
  };
  netOperatingIncome: number;
  debtService: number; // P&I + mortgage insurance
  cashFlow: number;
}

export interface QualificationCheck {
  name: string;
  pass: boolean;
  detail: string;
}

export interface Metrics {
  capRatePct: number;
  cashOnCashPct: number;
  grossRentMultiplier: number;
  /** Monthly rent / price — the "1% rule" input. */
  rentToValuePct: number;
  onePercentRule: boolean;
  /** Opex (incl. vacancy) as % of gross operating income — the "50% rule" check. */
  operatingExpenseRatioPct: number;
  breakEvenOccupancyPct: number;
  /** Lender DSCR: gross monthly rent / PITIA. What DSCR lenders actually use. */
  lenderDscr: number | null;
  /** Underwriting DSCR: annual NOI / annual debt service. */
  noiDscr: number | null;
}

export interface Underwriting {
  property: PropertyInput & { units: number };
  income: IncomeInput;
  financing: FinancingProfile;
  assumptions: Assumptions;
  loan: LoanBreakdown;
  monthly: MonthlyCashFlowStatement;
  /** The verdict metric: monthly cash flow at the user's stated financing. */
  monthlyCashFlow: number;
  annualCashFlow: number;
  cashToClose: number;
  metrics: Metrics;
  qualification: {
    pass: boolean;
    checks: QualificationCheck[];
  };
}

// ---------------------------------------------------------------------------
// Projections
// ---------------------------------------------------------------------------

export interface ProjectionYear {
  year: number;
  grossRent: number;
  netOperatingIncome: number;
  cashFlow: number;
  propertyValue: number;
  loanBalance: number;
  equity: number;
  returnOnEquityPct: number;
}

export interface Projection {
  years: ProjectionYear[];
  /** Annualized IRR if sold at the end of the final year (after selling costs). */
  irrAtExitPct: number | null;
  totalProfitAtExit: number;
  equityMultipleAtExit: number | null;
}
