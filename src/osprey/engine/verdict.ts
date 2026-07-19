import type { Underwriting } from './types';

export interface VerdictOptions {
  /** User's alert threshold: minimum monthly cash flow to text. */
  minMonthlyCashFlow?: number;
  /** Minutes since the listing appeared, when known. */
  listedMinutesAgo?: number;
}

export interface Verdict {
  /** Whether this underwriting clears the user's alert threshold. */
  meetsThreshold: boolean;
  /** SMS-ready alert text. */
  sms: string;
  /** Fuller breakdown for the "reply A" follow-up / dashboard deal page. */
  analysis: string;
}

const money = (n: number) =>
  `$${Math.round(Math.abs(n)).toLocaleString('en-US')}`;
const signedMoney = (n: number) => `${n < 0 ? '-' : '+'}${money(n)}`;

const TYPE_LABEL: Record<string, string> = {
  single_family: 'Single-family',
  duplex: 'Duplex',
  triplex: 'Triplex',
  fourplex: 'Fourplex',
};

const RENT_SOURCE_LABEL: Record<string, string> = {
  actual_leases: 'actual rents',
  listing_remarks: 'rents from listing',
  avm_estimate: 'est. rent',
  manual: 'your rent figure',
};

/** Build the user-facing verdict from an underwriting. */
export function buildVerdict(uw: Underwriting, opts: VerdictOptions = {}): Verdict {
  const p = uw.property;
  const cf = uw.monthlyCashFlow;
  const rentLabel = RENT_SOURCE_LABEL[uw.income.rent.source] ?? 'rent';
  const meetsThreshold =
    cf >= (opts.minMonthlyCashFlow ?? Number.NEGATIVE_INFINITY) && uw.qualification.pass;

  const where = [p.address, p.city].filter(Boolean).join(', ');
  const freshness =
    opts.listedMinutesAgo != null
      ? opts.listedMinutesAgo < 60
        ? `New ${Math.round(opts.listedMinutesAgo)} min ago`
        : `New ${Math.round(opts.listedMinutesAgo / 60)}h ago`
      : 'New';

  const failures = uw.qualification.checks.filter((c) => !c.pass);
  const flagLine = failures.length
    ? `\n⚠ ${failures.map((f) => f.detail).join('; ')}`
    : '';

  const sms =
    `🦅 ${freshness}: ${TYPE_LABEL[p.propertyType]}${where ? ` · ${where}` : ''} — ${money(p.price)}\n` +
    `At your ${uw.loan.label}: ${signedMoney(cf)}/mo (${rentLabel} ${money(uw.monthly.grossRent)}/mo)\n` +
    `Cap ${uw.metrics.capRatePct.toFixed(1)}% · CoC ${uw.metrics.cashOnCashPct.toFixed(1)}%` +
    (uw.metrics.lenderDscr != null ? ` · DSCR ${uw.metrics.lenderDscr.toFixed(2)}` : '') +
    flagLine +
    `\nReply A for full analysis, P to pass`;

  const m = uw.monthly;
  const analysis = [
    `${TYPE_LABEL[p.propertyType]} · ${where || 'address n/a'} · ${money(p.price)} · ${p.units} unit(s)`,
    ``,
    `FINANCING — ${uw.loan.label}`,
    `  Down ${money(uw.loan.downPayment)} · Loan ${money(uw.loan.amountFinanced)} @ ${(uw.loan.rate * 100).toFixed(2)}% / ${uw.loan.termYears}yr${uw.loan.interestOnly ? ' (interest-only)' : ''}`,
    `  P&I ${money(uw.loan.monthlyPrincipalAndInterest)}/mo` +
      (uw.loan.monthlyMortgageInsurance > 0
        ? ` · MI ${money(uw.loan.monthlyMortgageInsurance)}/mo`
        : ''),
    `  Cash to close ${money(uw.cashToClose)}`,
    ``,
    `MONTHLY NUMBERS (${rentLabel}${uw.income.rent.note ? ` — ${uw.income.rent.note}` : ''})`,
    `  Gross rent        ${money(m.grossRent)}`,
    `  Vacancy (${(uw.assumptions.vacancyPct * 100).toFixed(0)}%)      -${money(m.vacancyLoss)}`,
    `  Taxes             -${money(m.expenses.taxes)}`,
    `  Insurance         -${money(m.expenses.insurance)}`,
    `  Maintenance       -${money(m.expenses.maintenance)}`,
    `  CapEx reserve     -${money(m.expenses.capex)}`,
    `  Management        -${money(m.expenses.management)}`,
    ...(m.expenses.hoa > 0 ? [`  HOA               -${money(m.expenses.hoa)}`] : []),
    ...(m.expenses.utilities > 0 ? [`  Utilities         -${money(m.expenses.utilities)}`] : []),
    `  NOI               ${money(m.netOperatingIncome)}`,
    `  Debt service      -${money(m.debtService)}`,
    `  CASH FLOW         ${signedMoney(m.cashFlow)}/mo`,
    ``,
    `METRICS`,
    `  Cap rate ${uw.metrics.capRatePct.toFixed(2)}% · CoC ${uw.metrics.cashOnCashPct.toFixed(2)}% · GRM ${uw.metrics.grossRentMultiplier.toFixed(1)}`,
    `  Rent/value ${uw.metrics.rentToValuePct.toFixed(2)}% (1% rule: ${uw.metrics.onePercentRule ? 'pass' : 'miss'})`,
    `  Break-even occupancy ${uw.metrics.breakEvenOccupancyPct.toFixed(0)}%` +
      (uw.metrics.lenderDscr != null ? ` · Lender DSCR ${uw.metrics.lenderDscr.toFixed(2)}` : ''),
    ...(uw.qualification.checks.length
      ? [
          ``,
          `QUALIFICATION`,
          ...uw.qualification.checks.map(
            (c) => `  ${c.pass ? '✓' : '✗'} ${c.detail}`,
          ),
        ]
      : []),
  ].join('\n');

  return { meetsThreshold, sms, analysis };
}
