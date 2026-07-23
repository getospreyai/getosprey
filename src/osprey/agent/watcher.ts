// The Watcher: pulls active listings, filters to never-seen ids, and hands
// them to the loop. Data source is RentCast today; the fixture path exists so
// everything downstream runs without an API key. Also owns deriving WatchTarget
// markets from investor buy boxes (deriveMarkets) for the multi-market cron.

import { readFileSync } from 'node:fs';
import type { RentCastListing, RentCastRentEstimate } from '../engine/index';
import { RentCastClient } from '../engine/index';
import type { BuyBox } from './model';

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

/** Human-readable market label for logs, e.g. "Las Vegas, NV" or "NV". */
export function marketLabel(target: WatchTarget): string {
  return target.city ? `${target.city}, ${target.state}` : target.state;
}

/**
 * Distinct scan targets across onboarded profiles' buy boxes — the
 * cities x states cross product per profile (a profile with states but no
 * cities contributes one whole-state target), deduped case-insensitively.
 * Profiles with no state contribute nothing: RentCast requires a state per
 * query, so a city-only buy box (no onboarding path produces one today) has
 * no target to derive. Order is first-seen — deterministic, so the
 * OSPREY_MAX_MARKETS cap always drops the same targets given the same
 * profile order, which is what makes this fixture-testable.
 */
export function deriveMarkets(profiles: { buyBox: BuyBox }[]): WatchTarget[] {
  const byKey = new Map<string, WatchTarget>();
  for (const { buyBox } of profiles) {
    const states = buyBox.states ?? [];
    const cities = buyBox.cities ?? [];
    for (const rawState of states) {
      const state = rawState.toUpperCase();
      if (cities.length === 0) {
        const key = `|${state}`;
        if (!byKey.has(key)) byKey.set(key, { state });
        continue;
      }
      for (const city of cities) {
        const key = `${city.toLowerCase()}|${state}`;
        if (!byKey.has(key)) byKey.set(key, { city, state });
      }
    }
  }
  return [...byKey.values()];
}

/** Does this buy box include the given market? Mirrors matchesBuyBox's
 *  state/city rules (case-insensitive; an empty states/cities list on the
 *  box means "no restriction" on that dimension, i.e. a whole-state box
 *  matches every city market within that state). Used to scope which
 *  profiles a market's batch is worth checking against — matchesBuyBox
 *  still does the authoritative per-listing check. */
export function buyBoxTargetsMarket(box: BuyBox, target: WatchTarget): boolean {
  if (box.states?.length) {
    if (!box.states.some((s) => s.toUpperCase() === target.state)) return false;
  }
  const targetCity = target.city;
  if (targetCity && box.cities?.length) {
    if (!box.cities.some((c) => c.toLowerCase() === targetCity.toLowerCase())) return false;
  }
  return true;
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
