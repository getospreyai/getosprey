import type {
  Assumptions,
  FinancingProfile,
  IncomeInput,
  Metrics,
  MonthlyCashFlowStatement,
  PropertyInput,
  QualificationCheck,
  Underwriting,
} from './types';
import { DSCR_DEFAULTS, STANDARD_ASSUMPTIONS, UNITS_BY_TYPE } from './defaults';
import { buildLoan } from './loan';

export interface UnderwriteInput {
  property: PropertyInput;
  income: IncomeInput;
  financing: FinancingProfile;
  assumptions?: Partial<Assumptions>;
}

/**
 * Core engine entry point: one listing + one financing profile -> a full
 * underwriting whose headline number is monthly cash flow at that financing.
 */
export function underwrite(input: UnderwriteInput): Underwriting {
  const assumptions: Assumptions = { ...STANDARD_ASSUMPTIONS, ...input.assumptions };
  const property = {
    ...input.property,
    units: input.property.units ?? UNITS_BY_TYPE[input.property.propertyType],
  };
  const { price } = property;
  const loan = buildLoan(price, input.financing);

  // ----- Income (monthly) -----
  const grossRent = input.income.rent.monthlyRent;
  const otherIncome = input.income.otherMonthlyIncome ?? 0;
  const vacancyLoss = grossRent * assumptions.vacancyPct;
  const effectiveGrossIncome = grossRent - vacancyLoss + otherIncome;

  // ----- Operating expenses (monthly) -----
  const taxes = (property.annualTaxes ?? price * assumptions.taxRatePct) / 12;
  const insurance = (property.annualInsurance ?? price * assumptions.insuranceRatePct) / 12;
  const maintenance = grossRent * assumptions.maintenancePct;
  const capex = grossRent * assumptions.capexPct;
  const management = effectiveGrossIncome * assumptions.managementPct;
  const utilities = assumptions.utilitiesMonthly;
  const hoa = property.hoaMonthly ?? 0;
  const other = assumptions.otherMonthlyExpense;
  const totalExpenses =
    taxes + insurance + maintenance + capex + management + utilities + hoa + other;

  const netOperatingIncome = effectiveGrossIncome - totalExpenses;
  const debtService = loan.monthlyPrincipalAndInterest + loan.monthlyMortgageInsurance;
  const cashFlow = netOperatingIncome - debtService;

  const monthly: MonthlyCashFlowStatement = {
    grossRent,
    otherIncome,
    vacancyLoss,
    effectiveGrossIncome,
    expenses: {
      taxes,
      insurance,
      maintenance,
      capex,
      management,
      utilities,
      hoa,
      other,
      total: totalExpenses,
    },
    netOperatingIncome,
    debtService,
    cashFlow,
  };

  // ----- Cash needed -----
  const closingCosts = price * assumptions.purchaseClosingPct;
  const cashToClose = loan.downPayment + closingCosts + loan.upfrontFeesCash;

  // ----- Metrics -----
  const annualNoi = netOperatingIncome * 12;
  const annualDebtService = debtService * 12;
  const annualCashFlow = cashFlow * 12;
  const grossOperatingIncome = effectiveGrossIncome; // monthly

  // PITIA: principal, interest, taxes, insurance, association dues — what
  // DSCR lenders divide gross rent by.
  const pitia = debtService + taxes + insurance + hoa;

  const metrics: Metrics = {
    capRatePct: price > 0 ? (annualNoi / price) * 100 : 0,
    cashOnCashPct: cashToClose > 0 ? (annualCashFlow / cashToClose) * 100 : 0,
    grossRentMultiplier: grossRent > 0 ? price / (grossRent * 12) : 0,
    rentToValuePct: price > 0 ? (grossRent / price) * 100 : 0,
    onePercentRule: price > 0 && grossRent / price >= 0.01,
    operatingExpenseRatioPct:
      grossOperatingIncome > 0
        ? ((totalExpenses + vacancyLoss) / (grossRent + otherIncome)) * 100
        : 0,
    breakEvenOccupancyPct:
      grossRent > 0 ? ((totalExpenses + debtService) / (grossRent + otherIncome)) * 100 : 0,
    lenderDscr: pitia > 0 && loan.kind !== 'cash' ? grossRent / pitia : null,
    noiDscr: annualDebtService > 0 ? annualNoi / annualDebtService : null,
  };

  // ----- Loan-product qualification checks -----
  const checks: QualificationCheck[] = [];
  if (input.financing.kind === 'dscr') {
    const min = input.financing.minDscr ?? DSCR_DEFAULTS.minDscr;
    const ratio = metrics.lenderDscr ?? 0;
    checks.push({
      name: 'dscr_minimum',
      pass: ratio >= min,
      detail: `Lender DSCR ${ratio.toFixed(2)} vs minimum ${min.toFixed(2)} (rent / PITIA)`,
    });
    if (ratio >= 1.25) {
      checks.push({
        name: 'dscr_best_pricing',
        pass: true,
        detail: `DSCR ${ratio.toFixed(2)} ≥ 1.25 — qualifies for best rate tiers`,
      });
    }
  }
  if (input.financing.kind === 'fha' && property.units >= 3) {
    // FHA self-sufficiency test (3–4 units): 75% of gross rent must cover PITI.
    const piti = debtService + taxes + insurance;
    const selfSufficiencyIncome = 0.75 * grossRent;
    checks.push({
      name: 'fha_self_sufficiency',
      pass: selfSufficiencyIncome >= piti,
      detail: `75% of gross rent $${selfSufficiencyIncome.toFixed(0)} vs PITI $${piti.toFixed(0)}`,
    });
  }

  return {
    property,
    income: input.income,
    financing: input.financing,
    assumptions,
    loan,
    monthly,
    monthlyCashFlow: cashFlow,
    annualCashFlow,
    cashToClose,
    metrics,
    qualification: {
      pass: checks.every((c) => c.pass),
      checks,
    },
  };
}
