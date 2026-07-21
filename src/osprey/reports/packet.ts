// Deterministic lender/investor deal-packet PDF (no LLM) — the "send this to
// my lender or co-investor" one-pager+. Distinct from reports/pdf.ts (which
// renders the paused AI research report): this renders straight off
// already-computed engine output (Underwriting/Projection/solver results),
// so it regenerates identically from the same numbers the property page
// shows. Layout primitives live in ./pdf-kit (shared with reports/pdf.ts).

import type {
  MaxOfferResult,
  RentBasis,
  Section8Standard,
  Underwriting,
  Projection,
} from "@/osprey/engine";
import type { RentComparable } from "@/lib/rent-comparables";
import { showClearingRateLine } from "@/lib/property-insights";
import { formatMoney, formatPct, formatSignedMoney, formatSignedMonthly } from "@/lib/format";
import {
  createPdfCursor,
  draw,
  drawTableHeader,
  drawTableRow,
  footerOnEveryPage,
  gap,
  masthead,
  sectionHeading,
  EMERALD,
  AMBER,
  INK,
  MUTED,
  CONTENT_W,
  type PdfCursor,
  type TableColumn,
} from "./pdf-kit";

export interface DealPacketInput {
  address: string;
  preparedBy: string;
  uw: Underwriting;
  projection: Projection;
  rent: RentBasis;
  /** Already top-N'd + sorted by correlation (lib/rent-comparables.ts). */
  comparables: RentComparable[];
  maxOffer: MaxOfferResult | null;
  clearingRate: number | null;
  section8: Section8Standard | null;
  /** The investor's alert bar — frames the max-offer section like the UI card does. */
  bar: number;
  daysOnMarket?: number;
}

const KEY_YEARS = [1, 2, 3, 5, 10, 20, 30];

// Two-column "label ..... value" layout for statement/metrics/loan/appendix
// lists — same column primitives as the tables, just one wide left column.
const STAT_COLS: TableColumn[] = [
  { header: "", width: CONTENT_W - 140 },
  { header: "", width: 140, align: "right" },
];

function statRow(c: PdfCursor, label: string, value: string, bold = false): void {
  // Print-friendly: black text throughout, subtotal emphasis comes from
  // bold weight (not a lighter gray) so this holds up scanned/printed too.
  drawTableRow(c, STAT_COLS, [label, value], { size: 9.5, bold, color: INK });
}

const PROJECTION_COLS: TableColumn[] = [
  { header: "Year", width: 45 },
  { header: "Cash flow", width: 90, align: "right" },
  { header: "Value", width: 95, align: "right" },
  { header: "Loan bal.", width: 95, align: "right" },
  { header: "Equity", width: 90, align: "right" },
  { header: "ROE", width: 85, align: "right" },
];

const COMP_COLS: TableColumn[] = [
  { header: "Address", width: 165 },
  { header: "Rent", width: 60, align: "right" },
  { header: "Bd/Ba", width: 45, align: "right" },
  { header: "Dist", width: 45, align: "right" },
  { header: "Match", width: 50, align: "right" },
  { header: "Status", width: 95 },
];

export async function dealPacketPdf(input: DealPacketInput): Promise<Uint8Array> {
  const { uw, projection } = input;
  const c = await createPdfCursor();

  // ---- Cover: address, hero verdict, prepared-by + date ----
  masthead(c, "Lender Deal Packet");
  draw(c, input.address, c.bold, 16, INK, 1.3);
  gap(c, 4);

  const heroColor = uw.monthlyCashFlow >= 0 ? EMERALD : AMBER;
  const heroLine =
    `${formatSignedMonthly(uw.monthlyCashFlow)} at ${uw.loan.label}` +
    ` · Cap ${formatPct(uw.metrics.capRatePct, 2)} · CoC ${formatPct(uw.metrics.cashOnCashPct, 2)}` +
    (uw.metrics.lenderDscr != null ? ` · DSCR ${uw.metrics.lenderDscr.toFixed(2)}` : "") +
    ` · ${uw.qualification.pass ? "Qualifies" : "Needs a look"}`;
  draw(c, heroLine, c.bold, 11.5, heroColor, 1.4);
  gap(c, 4);

  const preparedLine =
    `Prepared by ${input.preparedBy} · ` +
    new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });
  draw(c, preparedLine, c.font, 9.5, MUTED, 1.3);
  gap(c, 10);

  // ---- Full monthly statement ----
  sectionHeading(c, "Monthly Statement");
  const m = uw.monthly;
  statRow(c, "Gross rent", formatMoney(m.grossRent));
  if (m.otherIncome > 0) statRow(c, "Other income", formatMoney(m.otherIncome));
  statRow(c, "Vacancy loss", `−${formatMoney(m.vacancyLoss)}`);
  statRow(c, "Effective gross income", formatMoney(m.effectiveGrossIncome), true);
  statRow(c, "Taxes", `−${formatMoney(m.expenses.taxes)}`);
  statRow(c, "Insurance", `−${formatMoney(m.expenses.insurance)}`);
  statRow(c, "Maintenance", `−${formatMoney(m.expenses.maintenance)}`);
  statRow(c, "CapEx reserve", `−${formatMoney(m.expenses.capex)}`);
  statRow(c, "Management", `−${formatMoney(m.expenses.management)}`);
  if (m.expenses.utilities > 0) statRow(c, "Utilities", `−${formatMoney(m.expenses.utilities)}`);
  if (m.expenses.hoa > 0) statRow(c, "HOA", `−${formatMoney(m.expenses.hoa)}`);
  if (m.expenses.other > 0) statRow(c, "Other", `−${formatMoney(m.expenses.other)}`);
  statRow(c, "Net operating income", formatMoney(m.netOperatingIncome), true);
  statRow(c, "Debt service", `−${formatMoney(m.debtService)}`);
  statRow(c, "Monthly cash flow", formatSignedMonthly(uw.monthlyCashFlow), true);
  gap(c, 10);

  // ---- Metrics grid ----
  sectionHeading(c, "Metrics");
  statRow(c, "Cap rate", formatPct(uw.metrics.capRatePct, 2));
  statRow(c, "Cash on cash", formatPct(uw.metrics.cashOnCashPct, 2));
  statRow(c, "Gross rent multiplier", uw.metrics.grossRentMultiplier.toFixed(1));
  statRow(
    c,
    "1% rule (rent/value)",
    `${formatPct(uw.metrics.rentToValuePct, 2)} — ${uw.metrics.onePercentRule ? "passes" : "misses"}`,
  );
  statRow(c, "Break-even occupancy", formatPct(uw.metrics.breakEvenOccupancyPct, 0));
  statRow(c, "Operating expense ratio", formatPct(uw.metrics.operatingExpenseRatioPct, 0));
  if (uw.metrics.lenderDscr != null) statRow(c, "Lender DSCR", uw.metrics.lenderDscr.toFixed(2));
  statRow(c, "Cash to close", formatMoney(uw.cashToClose));
  gap(c, 10);

  // ---- Loan breakdown ----
  sectionHeading(c, "Loan Breakdown");
  statRow(c, "Product", uw.loan.label);
  statRow(c, "Down payment", formatMoney(uw.loan.downPayment));
  statRow(c, "Amount financed", formatMoney(uw.loan.amountFinanced));
  statRow(c, "LTV", formatPct(uw.loan.ltv * 100, 1));
  if (uw.loan.kind !== "cash") {
    statRow(c, "Rate / term", `${formatPct(uw.loan.rate * 100, 3)} / ${uw.loan.termYears}yr${uw.loan.interestOnly ? " IO" : ""}`);
    statRow(c, "Principal & interest", formatMoney(uw.loan.monthlyPrincipalAndInterest));
  }
  if (uw.loan.monthlyMortgageInsurance > 0) {
    statRow(c, "Mortgage insurance", formatMoney(uw.loan.monthlyMortgageInsurance));
  }
  if (uw.loan.upfrontFeesCash > 0) statRow(c, "Upfront fees (cash)", formatMoney(uw.loan.upfrontFeesCash));
  gap(c, 10);

  // ---- 30-yr projection (key years) ----
  sectionHeading(c, `${projection.years.length}-Year Projection`);
  drawTableHeader(c, PROJECTION_COLS);
  for (const y of projection.years.filter((y) => KEY_YEARS.includes(y.year))) {
    drawTableRow(c, PROJECTION_COLS, [
      String(y.year),
      formatSignedMoney(y.cashFlow),
      formatMoney(y.propertyValue),
      formatMoney(y.loanBalance),
      formatMoney(y.equity),
      formatPct(y.returnOnEquityPct, 1),
    ]);
  }
  gap(c, 6);
  statRow(c, "Total profit at exit", formatMoney(projection.totalProfitAtExit));
  statRow(c, "IRR at exit", projection.irrAtExitPct != null ? formatPct(projection.irrAtExitPct, 1) : "n/a");
  statRow(
    c,
    "Equity multiple",
    projection.equityMultipleAtExit != null ? `${projection.equityMultipleAtExit.toFixed(2)}x` : "n/a",
  );
  gap(c, 10);

  // ---- Rent comparables + range ----
  sectionHeading(c, "Rent Comparables");
  const rangeClause =
    input.rent.rangeLow != null && input.rent.rangeHigh != null
      ? ` (range ${formatMoney(input.rent.rangeLow)}–${formatMoney(input.rent.rangeHigh)})`
      : "";
  draw(c, `Point estimate: ${formatMoney(input.rent.monthlyRent)}/mo${rangeClause}`, c.font, 9.5, INK, 1.35);
  gap(c, 6);
  if (input.comparables.length === 0) {
    draw(c, "No comparable rentals came back with this AVM estimate.", c.font, 9.5, MUTED, 1.35);
  } else {
    drawTableHeader(c, COMP_COLS);
    for (const comp of input.comparables) {
      drawTableRow(c, COMP_COLS, [
        comp.formattedAddress,
        formatMoney(comp.price),
        `${comp.bedrooms ?? "–"}/${comp.bathrooms ?? "–"}`,
        comp.distance != null ? `${comp.distance.toFixed(1)}mi` : "–",
        `${Math.round(comp.correlation * 100)}%`,
        `${comp.status ?? "–"}${comp.daysOnMarket != null ? ` · ${comp.daysOnMarket}d` : ""}`,
      ]);
    }
  }
  gap(c, 10);

  // ---- Section 8 line (only when the metro's FMR table covers this bedroom count) ----
  if (input.section8) {
    sectionHeading(c, "Section 8 Payment Standard");
    draw(
      c,
      `${formatMoney(input.section8.standard)}/mo (Las Vegas metro) — ${input.section8.label}`,
      c.font,
      9.5,
      INK,
      1.35,
    );
    gap(c, 10);
  }

  // ---- Max-offer analysis ----
  sectionHeading(c, "Max-Offer Analysis");
  if (!input.maxOffer) {
    draw(
      c,
      `Doesn't clear the ${formatMoney(input.bar)}/mo bar even well below ask — the numbers don't work ` +
        `at any realistic price for this financing.`,
      c.font,
      9.5,
      AMBER,
      1.4,
    );
  } else if (input.maxOffer.clearsAtAsk) {
    draw(
      c,
      `Clears the ${formatMoney(input.bar)}/mo bar at ask — headroom to ${formatMoney(input.maxOffer.maxPrice)}` +
        (input.maxOffer.pctVsAsk > 0 ? ` (${formatPct(input.maxOffer.pctVsAsk, 1)} above ask)` : "") +
        `.`,
      c.font,
      9.5,
      EMERALD,
      1.4,
    );
  } else {
    const domClause =
      input.daysOnMarket != null ? ` · ${Math.round(input.daysOnMarket)} days on market` : "";
    draw(
      c,
      `Doesn't clear the ${formatMoney(input.bar)}/mo bar at ask. Max offer: ${formatMoney(input.maxOffer.maxPrice)} ` +
        `— ${Math.abs(input.maxOffer.pctVsAsk).toFixed(1)}% below ask${domClause}.`,
      c.font,
      9.5,
      AMBER,
      1.4,
    );
  }
  if (showClearingRateLine(input.clearingRate, uw.loan.rate)) {
    gap(c, 3);
    draw(
      c,
      `Clears at a ${(input.clearingRate * 100).toFixed(2)}% rate (profile: ${(uw.loan.rate * 100).toFixed(2)}%).`,
      c.font,
      9,
      MUTED,
      1.35,
    );
  }
  gap(c, 10);

  // ---- Assumptions appendix ----
  sectionHeading(c, "Underwriting Assumptions");
  const a = uw.assumptions;
  statRow(c, "Vacancy", formatPct(a.vacancyPct * 100, 1));
  statRow(c, "Maintenance", formatPct(a.maintenancePct * 100, 1));
  statRow(c, "CapEx reserve", formatPct(a.capexPct * 100, 1));
  statRow(c, "Property management", formatPct(a.managementPct * 100, 1));
  statRow(c, "Purchase closing costs", formatPct(a.purchaseClosingPct * 100, 1));
  statRow(c, "Selling costs at exit", formatPct(a.sellingCostPct * 100, 1));
  if (a.utilitiesMonthly > 0) statRow(c, "Owner-paid utilities", formatMoney(a.utilitiesMonthly));
  if (a.otherMonthlyExpense > 0) statRow(c, "Other monthly expense", formatMoney(a.otherMonthlyExpense));
  statRow(c, "Property tax rate (fallback)", formatPct(a.taxRatePct * 100, 2));
  statRow(c, "Insurance rate (fallback)", formatPct(a.insuranceRatePct * 100, 2));
  statRow(c, "Annual appreciation", formatPct(a.annualAppreciationPct * 100, 1));
  statRow(c, "Annual income growth", formatPct(a.annualIncomeGrowthPct * 100, 1));
  statRow(c, "Annual expense growth", formatPct(a.annualExpenseGrowthPct * 100, 1));

  footerOnEveryPage(c, `Prepared by ${input.preparedBy} with Osprey · getosprey.ai`);

  return c.doc.save();
}
