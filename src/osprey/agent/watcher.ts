// The Watcher: pulls active listings, filters to never-seen ids, and hands
// them to the loop. Data source is RentCast today; the fixture path exists so
// everything downstream runs without an API key.

import { readFileSync } from 'node:fs';
import type { RentCastListing, RentCastRentEstimate } from '../engine/index';
import { RentCastClient } from '../engine/index';

export interface WatchTarget {
  city?: string;
  state: string;
  /** Only listings at most this many days old (RentCast minimum is 1). */
  daysOld: number;
}

export interface ListingBatch {
  listings: RentCastListing[];
  /** Rent estimates keyed by listing id (fixtures provide these inline). */
  rentEstimates: Map<string, RentCastRentEstimate>;
}

export async function fetchBatch(
  client: RentCastClient,
  target: WatchTarget,
): Promise<ListingBatch> {
  const listings = await client.fetchSaleListings({
    city: target.city,
    state: target.state,
    daysOld: target.daysOld,
  });
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
