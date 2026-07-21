import type { Underwriting } from './types';
import type { MaxOfferResult } from './solver';

export interface VerdictOptions {
  /** User's alert threshold: minimum monthly cash flow to text. */
  minMonthlyCashFlow?: number;
  /** Minutes since the listing appeared, when known. */
  listedMinutesAgo?: number;
  /** Days on market, when known — feeds the MAX OFFER block's near-miss line. */
  daysOnMarket?: number;
  /** Precomputed max-offer solve at the listing's ask price (solver.ts). Omit when not solved. */
  maxOffer?: MaxOfferResult | null;
  /** Precomputed clearing-rate solve, financed profiles only (solver.ts). */
  clearingRate?: number | null;
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
const moneyK = (n: number) => `$${Math.round(n / 1000)}k`;
const signedPct = (n: number) => `${n >= 0 ? '+' : ''}${n.toFixed(1)}%`;

/**
 * One-line MAX OFFER summary, shared by the full analysis block and the
 * price-cut alert: near-miss ("doesn't clear, here's the ceiling that
 * would") or headroom ("clears with room to spare, here's how much").
 */
function maxOfferLine(maxOffer: MaxOfferResult, askPrice: number, daysOnMarket?: number): string {
  if (maxOffer.clearsAtAsk) {
    return `Headroom: still clears up to ${money(maxOffer.maxPrice)}`;
  }
  const domClause = daysOnMarket != null ? ` · ${Math.round(daysOnMarket)} days on market` : '';
  return (
    `Doesn't clear at ${money(askPrice)} — max offer ${money(maxOffer.maxPrice)} ` +
    `(${Math.abs(maxOffer.pctVsAsk).toFixed(1)}% below ask${domClause})`
  );
}

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

  // Near-misses within 15% of ask get one extra SMS line; beyond that the
  // gap is noise, not an actionable number — stay quiet.
  const maxOfferSmsLine =
    opts.maxOffer && !opts.maxOffer.clearsAtAsk && Math.abs(opts.maxOffer.pctVsAsk) <= 15
      ? `\nMax offer: ${moneyK(opts.maxOffer.maxPrice)} (${signedPct(opts.maxOffer.pctVsAsk)})`
      : '';

  const sms =
    `🦅 ${freshness}: ${TYPE_LABEL[p.propertyType]}${where ? ` · ${where}` : ''} — ${money(p.price)}\n` +
    `At your ${uw.loan.label}: ${signedMoney(cf)}/mo (${rentLabel} ${money(uw.monthly.grossRent)}/mo)\n` +
    `Cap ${uw.metrics.capRatePct.toFixed(1)}% · CoC ${uw.metrics.cashOnCashPct.toFixed(1)}%` +
    (uw.metrics.lenderDscr != null ? ` · DSCR ${uw.metrics.lenderDscr.toFixed(2)}` : '') +
    flagLine +
    maxOfferSmsLine +
    `\nReply A for full analysis, P to pass`;

  // MAX OFFER block: near-miss ceiling or headroom, plus a clearing-rate
  // line when the solved rate is realistic (>=3%) and actually below the
  // investor's profile rate (otherwise the deal already clears as-is and
  // the line would be redundant).
  const maxOfferLines: string[] = [];
  if (opts.maxOffer) {
    maxOfferLines.push(maxOfferLine(opts.maxOffer, p.price, opts.daysOnMarket));
  }
  if (opts.clearingRate != null && opts.clearingRate >= 0.03 && opts.clearingRate < uw.loan.rate) {
    maxOfferLines.push(
      `Clears at ${(opts.clearingRate * 100).toFixed(2)}% rate (profile: ${(uw.loan.rate * 100).toFixed(2)}%)`,
    );
  }

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
    ...(maxOfferLines.length
      ? [``, `MAX OFFER`, ...maxOfferLines.map((l) => `  ${l}`)]
      : []),
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

export interface PriceCutAlertInput {
  /** "address, city" — same shape loop.ts already builds for VerdictRecord.address. */
  address: string;
  /** The listing's previous price, from the snapshot diff. */
  oldPrice: number;
  daysOnMarket?: number;
  /** True when the listing's history shows more than one price decrease. */
  repeatCut?: boolean;
  /** Max-offer solve at the NEW price, if one was run. */
  maxOffer?: MaxOfferResult | null;
}

/**
 * SMS for a price-cut re-underwrite that just started clearing the
 * investor's bar. Leads with the metric that moved (cash flow) — the price
 * is supporting evidence, not the headline (see wave2-research.md
 * "Price-cut alert presentation" for the rationale).
 */
export function buildPriceCutAlert(uw: Underwriting, input: PriceCutAlertInput): string {
  const newPrice = uw.property.price;
  const delta = newPrice - input.oldPrice;
  const pctCut = input.oldPrice > 0 ? (delta / input.oldPrice) * 100 : 0;
  const domClause = input.daysOnMarket != null ? ` · ${Math.round(input.daysOnMarket)}d on market` : '';
  const repeatClause = input.repeatCut ? ' · repeat cut' : '';

  const lines = [
    `📉 ${TYPE_LABEL[uw.property.propertyType]}${input.address ? ` · ${input.address}` : ''}`,
    `Now clears your bar at ${signedMoney(uw.monthlyCashFlow)}/mo`,
    `${money(input.oldPrice)} → ${money(newPrice)} · ${signedMoney(delta)} (${signedPct(pctCut)})${domClause}${repeatClause}`,
    `Cap ${uw.metrics.capRatePct.toFixed(1)}% · CoC ${uw.metrics.cashOnCashPct.toFixed(1)}%`,
  ];
  if (input.maxOffer) {
    lines.push(maxOfferLine(input.maxOffer, newPrice, input.daysOnMarket));
  }
  lines.push('Reply A for full analysis, P to pass');
  return lines.join('\n');
}
