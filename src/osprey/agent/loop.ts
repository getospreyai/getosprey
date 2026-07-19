// The loop: new listings × investor profiles → engine → verdict gate.
// Delivery is a pluggable `deliver` callback: console always, Telegram
// when a bot token is configured (SMS can slot in post-MVP the same way).

import type { RentCastListing, RentCastRentEstimate, Underwriting } from '../engine/index';
import { buildVerdict, toIncomeInput, toPropertyInput, underwrite } from '../engine/index';
import type { InvestorProfile } from './model';
import { matchesBuyBox } from './matcher';
import type { ListingBatch } from './watcher';

export interface VerdictRecord {
  at: string;
  investorId: string;
  listingId: string;
  address: string;
  price: number;
  financingLabel: string;
  monthlyCashFlow: number;
  qualifies: boolean;
  wouldText: boolean;
  sms: string;
  /** Full "reply A" breakdown — grounds the Messenger's answers about this deal. */
  analysis: string;
}

export interface ScanDeps {
  /** Resolve a rent estimate for a matched listing (fixture map or live AVM call). */
  getRent: (listing: RentCastListing) => Promise<RentCastRentEstimate | undefined>;
  /** May perform async delivery (e.g. a Telegram send); awaited so serverless
   *  invocations complete before the function exits. */
  deliver: (record: VerdictRecord) => void | Promise<void>;
  log?: (line: string) => void;
}

export interface ScanSummary {
  scanned: number;
  inNiche: number;
  matched: number;
  underwritten: number;
  texts: number;
}

export async function runScan(
  batch: ListingBatch,
  profiles: InvestorProfile[],
  seen: Set<string>,
  deps: ScanDeps,
): Promise<ScanSummary> {
  const log = deps.log ?? (() => {});
  const summary: ScanSummary = { scanned: 0, inNiche: 0, matched: 0, underwritten: 0, texts: 0 };

  for (const listing of batch.listings) {
    if (seen.has(listing.id)) continue;
    seen.add(listing.id);
    summary.scanned++;

    const property = toPropertyInput(listing);
    if (!property) continue; // out of niche (5+ units, condos, land, no price)
    summary.inNiche++;

    const interested = profiles.filter((p) => matchesBuyBox(listing, p.buyBox));
    if (interested.length === 0) continue;
    summary.matched++;

    const rentEstimate = await deps.getRent(listing);
    const income = rentEstimate ? toIncomeInput(rentEstimate) : null;
    if (!income) {
      log(`  no rent estimate for ${listing.id}, skipping`);
      continue;
    }

    for (const investor of interested) {
      // Underwrite at every financing profile; the best cash flow decides the alert.
      let best: Underwriting | null = null;
      for (const financing of investor.financingProfiles) {
        const uw = underwrite({ property, income, financing, assumptions: investor.assumptions });
        summary.underwritten++;
        if (!best || uw.monthlyCashFlow > best.monthlyCashFlow) best = uw;
      }
      if (!best) continue;

      const verdict = buildVerdict(best, {
        minMonthlyCashFlow: investor.minMonthlyCashFlow,
        listedMinutesAgo:
          listing.daysOnMarket != null ? listing.daysOnMarket * 24 * 60 : undefined,
      });
      if (verdict.meetsThreshold) summary.texts++;

      await deps.deliver({
        at: new Date().toISOString(),
        investorId: investor.id,
        listingId: listing.id,
        address: [listing.addressLine1, listing.city].filter(Boolean).join(', '),
        price: property.price,
        financingLabel: best.loan.label,
        monthlyCashFlow: Math.round(best.monthlyCashFlow),
        qualifies: best.qualification.pass,
        wouldText: verdict.meetsThreshold && investor.alertsPaused !== true,
        sms: verdict.sms,
        analysis: verdict.analysis,
      });
    }
  }
  return summary;
}
