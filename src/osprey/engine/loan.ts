import type { FinancingProfile, LoanBreakdown } from './types';
import { CONVENTIONAL_DEFAULTS, DSCR_DEFAULTS, FHA_DEFAULTS } from './defaults';

/** Standard amortizing payment (monthly). */
export function pmt(monthlyRate: number, nMonths: number, principal: number): number {
  if (principal <= 0 || nMonths <= 0) return 0;
  if (monthlyRate === 0) return principal / nMonths;
  return (principal * monthlyRate) / (1 - Math.pow(1 + monthlyRate, -nMonths));
}

/** Remaining balance of an amortizing loan after `monthsElapsed` payments. */
export function remainingBalance(
  principal: number,
  monthlyRate: number,
  nMonths: number,
  monthsElapsed: number,
): number {
  if (principal <= 0) return 0;
  if (monthsElapsed >= nMonths) return 0;
  if (monthlyRate === 0) return principal * (1 - monthsElapsed / nMonths);
  const payment = pmt(monthlyRate, nMonths, principal);
  const growth = Math.pow(1 + monthlyRate, monthsElapsed);
  return principal * growth - payment * ((growth - 1) / monthlyRate);
}

/** Resolve a financing profile against a purchase price into a loan breakdown. */
export function buildLoan(price: number, financing: FinancingProfile): LoanBreakdown {
  switch (financing.kind) {
    case 'cash': {
      return {
        kind: 'cash',
        label: financing.label ?? 'All cash',
        downPayment: price,
        amountFinanced: 0,
        ltv: 0,
        monthlyPrincipalAndInterest: 0,
        monthlyMortgageInsurance: 0,
        upfrontFeesCash: 0,
        interestOnly: false,
        termYears: 0,
        rate: 0,
      };
    }

    case 'conventional': {
      const termYears = financing.termYears ?? CONVENTIONAL_DEFAULTS.termYears;
      const downPayment = price * financing.downPct;
      const loan = price - downPayment;
      const ltv = price > 0 ? loan / price : 0;
      const pmiAnnualPct = financing.pmiAnnualPct ?? CONVENTIONAL_DEFAULTS.pmiAnnualPct;
      const monthlyMI = ltv > 0.8 ? (loan * pmiAnnualPct) / 12 : 0;
      return {
        kind: 'conventional',
        label: financing.label ?? `Conventional ${Math.round(financing.downPct * 100)}% down`,
        downPayment,
        amountFinanced: loan,
        ltv,
        monthlyPrincipalAndInterest: pmt(financing.rate / 12, termYears * 12, loan),
        monthlyMortgageInsurance: monthlyMI,
        upfrontFeesCash: 0,
        interestOnly: false,
        termYears,
        rate: financing.rate,
      };
    }

    case 'fha': {
      const downPct = financing.downPct ?? FHA_DEFAULTS.downPct;
      const termYears = financing.termYears ?? FHA_DEFAULTS.termYears;
      const ufmipPct = financing.ufmipPct ?? FHA_DEFAULTS.ufmipPct;
      const annualMipPct = financing.annualMipPct ?? FHA_DEFAULTS.annualMipPct;
      const financeUfmip = financing.financeUfmip !== false;
      const downPayment = price * downPct;
      const baseLoan = price - downPayment;
      const ufmip = baseLoan * ufmipPct;
      const totalLoan = baseLoan + (financeUfmip ? ufmip : 0);
      return {
        kind: 'fha',
        label: financing.label ?? `FHA ${(downPct * 100).toFixed(1)}% down`,
        downPayment,
        amountFinanced: totalLoan,
        ltv: price > 0 ? totalLoan / price : 0,
        monthlyPrincipalAndInterest: pmt(financing.rate / 12, termYears * 12, totalLoan),
        monthlyMortgageInsurance: (baseLoan * annualMipPct) / 12,
        upfrontFeesCash: financeUfmip ? 0 : ufmip,
        interestOnly: false,
        termYears,
        rate: financing.rate,
      };
    }

    case 'dscr': {
      const termYears = financing.termYears ?? DSCR_DEFAULTS.termYears;
      const downPayment = price * financing.downPct;
      const loan = price - downPayment;
      const interestOnly = financing.interestOnly === true;
      const monthlyPI = interestOnly
        ? (loan * financing.rate) / 12
        : pmt(financing.rate / 12, termYears * 12, loan);
      return {
        kind: 'dscr',
        label: financing.label ?? `DSCR ${Math.round(financing.downPct * 100)}% down`,
        downPayment,
        amountFinanced: loan,
        ltv: price > 0 ? loan / price : 0,
        monthlyPrincipalAndInterest: monthlyPI,
        monthlyMortgageInsurance: 0,
        upfrontFeesCash: 0,
        interestOnly,
        termYears,
        rate: financing.rate,
      };
    }
  }
}
