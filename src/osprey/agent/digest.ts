// Sunday weekly digest — deterministic text, no LLM. Pure function of the
// last 7 days of one investor's verdicts + the scan_runs tallies for the
// same window, so it's fully unit-testable against synthetic data (see
// wave2-spec.md "Verification"). The cron route (RENTCAST_ENABLED-gated)
// decides *when* to call this; this module only decides *what it says*.

import { formatMoney, formatMoneyCompact, formatSignedMonthly } from "@/lib/format";
import type { ScanRunTotals } from "../pg-store";

/** The slice of VerdictRecord the digest actually reads — kept narrow so
 *  this module doesn't need to import loop.ts. */
export interface DigestVerdict {
  address: string;
  monthlyCashFlow: number;
  capRatePct?: number;
  maxOffer?: { maxPrice: number; pctVsAsk: number; clearsAtAsk: boolean };
}

export interface DigestInput {
  /** The investor's CURRENT alert bar — "cleared" is evaluated against this,
   *  not whatever bar was in effect when each verdict was recorded. */
  bar: number;
  scanTotals: ScanRunTotals;
  /** This investor's verdicts from the last 7 days (store.loadVerdictsSince). */
  verdicts: DigestVerdict[];
}

function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/**
 * Builds the weekly digest message, or null when it should stay silent:
 * a dormant week (scan_runs has no rows — RENTCAST_ENABLED off, or the cron
 * simply didn't run) must produce silence, not a "0 listings scanned"
 * message that implies the product is broken rather than paused.
 */
export function buildWeeklyDigest(input: DigestInput): string | null {
  if (input.scanTotals.runCount === 0) return null;

  const { bar, scanTotals, verdicts } = input;
  const clears = verdicts.filter((v) => v.monthlyCashFlow >= bar);
  const misses = verdicts.filter((v) => v.monthlyCashFlow < bar);

  const medianCap = median(
    verdicts.map((v) => v.capRatePct).filter((n): n is number => n != null),
  );

  const sentences: string[] = [
    `🪶 Your week: ${scanTotals.scanned.toLocaleString("en-US")} listings scanned, ` +
      `${verdicts.length} matched your buy box` +
      (medianCap != null ? ` (median cap ${medianCap.toFixed(1)}%)` : "") +
      `, ${clears.length} cleared your ${formatMoney(bar)}/mo bar.`,
  ];

  if (misses.length > 0) {
    // "Closest" = smallest shortfall to the bar, i.e. the highest cash flow
    // among the misses.
    const closest = misses.reduce((best, v) => (v.monthlyCashFlow > best.monthlyCashFlow ? v : best));
    const offerClause =
      closest.maxOffer && !closest.maxOffer.clearsAtAsk
        ? ` — it would clear at ${formatMoneyCompact(closest.maxOffer.maxPrice)} ` +
          `(${Math.abs(closest.maxOffer.pctVsAsk).toFixed(1)}% below ask)`
        : "";
    sentences.push(
      `Closest: ${closest.address} at ${formatSignedMonthly(closest.monthlyCashFlow)}${offerClause}.`,
    );
  }

  if (scanTotals.priceChanges > 0) {
    sentences.push(
      `${scanTotals.priceChanges} price cut${scanTotals.priceChanges === 1 ? "" : "s"} tracked.`,
    );
  }

  // Only nudge about the bar when listings actually matched but none
  // cleared — if nothing matched at all, the buy box is the bottleneck, not
  // the bar, and this prompt would be the wrong fix.
  if (verdicts.length > 0 && clears.length === 0) {
    const suggestedBar = Math.max(0, Math.round((bar - 100) / 50) * 50);
    sentences.push(`Bar feels too high? Reply "lower my bar to ${suggestedBar}".`);
  }

  return sentences.join(" ");
}
