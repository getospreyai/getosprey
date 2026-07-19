import type { Projection, ProjectionYear, Underwriting } from './types';
import { remainingBalance } from './loan';

/**
 * Multi-year hold projection with exit analysis, in the style of standard
 * buy & hold projections: income/expenses grow, the property appreciates,
 * the loan amortizes, and IRR is computed on the full cash-flow series
 * including net sale proceeds at exit.
 */
export function project(uw: Underwriting, holdYears: number): Projection {
  const a = uw.assumptions;
  const years: ProjectionYear[] = [];
  const cashFlows: number[] = [-uw.cashToClose];

  const monthlyRate = uw.loan.rate / 12;
  const nMonths = uw.loan.termYears * 12;

  for (let y = 1; y <= holdYears; y++) {
    const incomeGrowth = Math.pow(1 + a.annualIncomeGrowthPct, y - 1);
    const expenseGrowth = Math.pow(1 + a.annualExpenseGrowthPct, y - 1);

    const grossRent = uw.monthly.grossRent * 12 * incomeGrowth;
    const otherIncome = uw.monthly.otherIncome * 12 * incomeGrowth;
    const vacancyLoss = grossRent * a.vacancyPct;
    const egi = grossRent - vacancyLoss + otherIncome;
    const opex = uw.monthly.expenses.total * 12 * expenseGrowth;
    const noi = egi - opex;

    const annualDebtService = uw.monthly.debtService * 12;
    const cashFlow = noi - annualDebtService;

    const propertyValue = uw.property.price * Math.pow(1 + a.annualAppreciationPct, y);
    const loanBalance = uw.loan.interestOnly
      ? uw.loan.amountFinanced
      : remainingBalance(uw.loan.amountFinanced, monthlyRate, nMonths, y * 12);
    const equity = propertyValue - loanBalance;

    years.push({
      year: y,
      grossRent,
      netOperatingIncome: noi,
      cashFlow,
      propertyValue,
      loanBalance,
      equity,
      returnOnEquityPct: equity > 0 ? (cashFlow / equity) * 100 : 0,
    });
    cashFlows.push(cashFlow);
  }

  // Exit: sell at end of final year.
  const last = years[years.length - 1];
  let irrAtExitPct: number | null = null;
  let totalProfitAtExit = 0;
  let equityMultipleAtExit: number | null = null;

  if (last) {
    const saleProceeds = last.propertyValue * (1 - a.sellingCostPct) - last.loanBalance;
    cashFlows[cashFlows.length - 1] += saleProceeds;
    const totalIn = uw.cashToClose;
    const totalOut = cashFlows.slice(1).reduce((s, c) => s + c, 0);
    totalProfitAtExit = totalOut - totalIn;
    equityMultipleAtExit = totalIn > 0 ? totalOut / totalIn : null;
    irrAtExitPct = irr(cashFlows);
  }

  return { years, irrAtExitPct, totalProfitAtExit, equityMultipleAtExit };
}

/** Annual IRR via bisection on NPV. Returns percent, or null if it doesn't bracket. */
export function irr(cashFlows: number[]): number | null {
  const npv = (r: number) =>
    cashFlows.reduce((sum, cf, t) => sum + cf / Math.pow(1 + r, t), 0);

  let lo = -0.9999;
  let hi = 10;
  let npvLo = npv(lo);
  const npvHi = npv(hi);
  if (npvLo * npvHi > 0) return null;

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const v = npv(mid);
    if (Math.abs(v) < 1e-9) return mid * 100;
    if (v * npvLo < 0) {
      hi = mid;
    } else {
      lo = mid;
      npvLo = v;
    }
  }
  return ((lo + hi) / 2) * 100;
}
