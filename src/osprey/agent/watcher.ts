// The Watcher: pulls active listings, filters to never-seen ids, and hands
// them to the loop. Data source is RentCast today; the fixture path exists so
// everything downstream runs without an API key.

import { readFileSync } from 'node:fs';
import type { RentCastListing, RentCastRentEstimate } from '../engine/index';
import { RentCastClient } from '../engine/index';

export interface WatchTarget {
  city?: string;
  state: string;
  /**
   * Only listings at most this many days old (RentCast minimum is 1). Omit
   * for a full paginated pull of the entire active set instead.
   *
   * `daysOld` on /listings/sale keys on `listedDate` — it's blind to price
   * cuts on listings that aren't brand-new (a mid-listing price change
   * doesn't reset listedDate). The daily cron wants the full active set so
   * its `seen` split can route already-known ids into the price-diff hook;
   * a one-off scan that only cares about brand-new listings (e.g. the
   * onboarding wizard's first-run scan) can keep using `daysOld`.
   */
  daysOld?: number;
}

export interface ListingBatch {
  listings: RentCastListing[];
  /** Rent estimates keyed by listing id (fixtures provide these inline). */
  rentEstimates: Map<string, RentCastRentEstimate>;
}

/** Page size for the full-pull branch — RentCast's max per call. */
const PAGE_LIMIT = 500;

export async function fetchBatch(
  client: RentCastClient,
  target: WatchTarget,
): Promise<ListingBatch> {
  if (target.daysOld != null) {
    const listings = await client.fetchSaleListings({
      city: target.city,
      state: target.state,
      daysOld: target.daysOld,
    });
    return { listings, rentEstimates: new Map() };
  }

  // Full active-set pull: paginate until a page returns fewer than the page
  // limit. ~12-20 calls/day for the Las Vegas metro (see
  // wave2-research.md RECOMMENDATIONS §1) — billed per call, not per result,
  // so this is the cheap way to diff ~all active listings daily.
  const listings: RentCastListing[] = [];
  let offset = 0;
  for (;;) {
    const page = await client.fetchSaleListings({
      city: target.city,
      state: target.state,
      limit: PAGE_LIMIT,
      offset,
    });
    listings.push(...page);
    if (page.length < PAGE_LIMIT) break;
    offset += PAGE_LIMIT;
  }
  return { listings, rentEstimates: new Map() };
}

/** Rent estimate with per-listing fetch, so we only spend AVM requests on matches. */
export async function fetchRentFor(
  client: RentCastClient,
  listing: RentCastListing,
): Promise<RentCastRentEstimate> {
  const address = [listing.addressLine1, listing.city, listing.state, listing.zipCode]
    .filter(Boolean)
    .join(', ');
  return client.fetchRentEstimate({
    address,
    propertyType: listing.propertyType,
    bedrooms: listing.bedrooms,
    bathrooms: listing.bathrooms,
    squareFootage: listing.squareFootage,
  });
}

/** Offline batch from a fixture file: [{ listing: {...}, rentEstimate: {...} }, ...] */
export function loadFixtureBatch(path: string): ListingBatch {
  const raw = JSON.parse(readFileSync(path, 'utf-8')) as Array<{
    listing: RentCastListing;
    rentEstimate: RentCastRentEstimate;
  }>;
  return {
    listings: raw.map((r) => r.listing),
    rentEstimates: new Map(raw.map((r) => [r.listing.id, r.rentEstimate])),
  };
}
