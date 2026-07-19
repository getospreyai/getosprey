// RentCast adapter: maps RentCast API responses into engine inputs, and
// provides thin fetch helpers for the two endpoints Osprey polls.
// Docs: https://developers.rentcast.io/
//
// The engine never depends on RentCast types — swap this adapter for an MLS
// feed (MLS Grid / Trestle / Bridge) without touching underwriting code.

import type { IncomeInput, PropertyInput, PropertyType } from './types';

const BASE_URL = 'https://api.rentcast.io/v1';

// --- Minimal shapes of the RentCast fields we consume -----------------------

export interface RentCastListing {
  id: string;
  formattedAddress?: string;
  addressLine1?: string;
  city?: string;
  state?: string;
  zipCode?: string;
  propertyType?: string; // "Single Family" | "Multi-Family" | ...
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  price?: number;
  listedDate?: string;
  lastSeenDate?: string;
  daysOnMarket?: number;
  hoa?: { fee?: number };
  unitCount?: number;
}

export interface RentCastRentEstimate {
  rent?: number;
  rentRangeLow?: number;
  rentRangeHigh?: number;
  comparables?: unknown[];
}

// --- Mapping -----------------------------------------------------------------

/** Map RentCast's propertyType/unitCount to the engine's SFR–fourplex niche. Returns null when out of niche. */
export function mapPropertyType(listing: RentCastListing): PropertyType | null {
  const t = (listing.propertyType ?? '').toLowerCase();
  if (t.includes('single family')) return 'single_family';
  if (t.includes('multi')) {
    const units = listing.unitCount ?? 2;
    if (units === 2) return 'duplex';
    if (units === 3) return 'triplex';
    if (units === 4) return 'fourplex';
    return null; // 5+ units: outside the current niche
  }
  return null; // condos, townhouses, land, etc. — out of niche for now
}

export function toPropertyInput(listing: RentCastListing): PropertyInput | null {
  const propertyType = mapPropertyType(listing);
  if (!propertyType || !listing.price || listing.price <= 0) return null;
  return {
    price: listing.price,
    propertyType,
    units: listing.unitCount,
    address: listing.addressLine1 ?? listing.formattedAddress,
    city: listing.city,
    state: listing.state,
    zip: listing.zipCode,
    hoaMonthly: listing.hoa?.fee,
    squareFeet: listing.squareFootage,
    yearBuilt: listing.yearBuilt,
    sourceId: listing.id,
  };
}

export function toIncomeInput(estimate: RentCastRentEstimate): IncomeInput | null {
  if (!estimate.rent || estimate.rent <= 0) return null;
  const comps = estimate.comparables?.length;
  return {
    rent: {
      monthlyRent: estimate.rent,
      source: 'avm_estimate',
      rangeLow: estimate.rentRangeLow,
      rangeHigh: estimate.rentRangeHigh,
      note: `RentCast AVM${comps ? `, ${comps} comps` : ''}`,
    },
  };
}

// --- Fetch helpers -------------------------------------------------------------

export interface RentCastClientOptions {
  apiKey: string;
  fetchImpl?: typeof fetch;
}

export class RentCastClient {
  private apiKey: string;
  private fetchImpl: typeof fetch;

  constructor(opts: RentCastClientOptions) {
    this.apiKey = opts.apiKey;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  private async get<T>(path: string, params: Record<string, string | number | undefined>): Promise<T> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined) qs.set(k, String(v));
    }
    const res = await this.fetchImpl(`${BASE_URL}${path}?${qs}`, {
      headers: { 'X-Api-Key': this.apiKey, Accept: 'application/json' },
    });
    if (!res.ok) {
      throw new Error(`RentCast ${path} failed: ${res.status} ${res.statusText}`);
    }
    return (await res.json()) as T;
  }

  /** Active sale listings, newest first. Use daysOld=1 for the polling loop. */
  fetchSaleListings(params: {
    city?: string;
    state?: string;
    zipCode?: string;
    propertyType?: string;
    daysOld?: number;
    limit?: number;
    offset?: number;
  }): Promise<RentCastListing[]> {
    return this.get<RentCastListing[]>('/listings/sale', {
      status: 'Active',
      limit: params.limit ?? 500,
      ...params,
    });
  }

  /** Long-term rent estimate (AVM) for one address. */
  fetchRentEstimate(params: {
    address: string;
    propertyType?: string;
    bedrooms?: number;
    bathrooms?: number;
    squareFootage?: number;
  }): Promise<RentCastRentEstimate> {
    return this.get<RentCastRentEstimate>('/avm/rent/long-term', params);
  }
}
