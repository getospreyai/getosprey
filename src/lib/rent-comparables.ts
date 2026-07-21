// Typed view over listing_snapshots.rent.comparables. The engine's
// RentCastRentEstimate (src/osprey/engine/rentcast.ts) deliberately leaves
// `comparables` as `unknown[]` — the engine doesn't consume them, only the
// UI does. Shape below is verified live (wave2-research.md): each entry
// carries formattedAddress/price(monthly rent)/bedrooms/bathrooms/
// squareFootage/distance/correlation/daysOnMarket/status among others.
// Parsed defensively rather than trusted, since this is third-party JSON
// stored verbatim in jsonb.

export interface RentComparable {
  formattedAddress: string;
  addressLine1?: string;
  city?: string;
  zipCode?: string;
  /** Monthly rent, dollars. */
  price: number;
  bedrooms?: number;
  bathrooms?: number;
  squareFootage?: number;
  yearBuilt?: number;
  propertyType?: string;
  /** Miles from the subject property. */
  distance?: number;
  /** 0-1 similarity score RentCast assigns the comp. */
  correlation: number;
  daysOnMarket?: number;
  daysOld?: number;
  status?: string;
  listedDate?: string;
  removedDate?: string;
  listingType?: string;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null;
}

function str(v: unknown): string | undefined {
  return typeof v === "string" ? v : undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === "number" && Number.isFinite(v) ? v : undefined;
}

/** Parse raw comparables into the typed shape, dropping entries missing the
 *  fields the comps table needs to render/sort (address, rent, correlation).
 *  Sorted by correlation descending (best match first). */
export function parseComparables(raw: unknown[] | undefined): RentComparable[] {
  if (!raw) return [];
  const out: RentComparable[] = [];

  for (const item of raw) {
    if (!isRecord(item)) continue;
    const formattedAddress = str(item.formattedAddress) ?? str(item.addressLine1);
    const price = num(item.price);
    const correlation = num(item.correlation);
    if (!formattedAddress || price == null || correlation == null) continue;

    out.push({
      formattedAddress,
      addressLine1: str(item.addressLine1),
      city: str(item.city),
      zipCode: str(item.zipCode),
      price,
      bedrooms: num(item.bedrooms),
      bathrooms: num(item.bathrooms),
      squareFootage: num(item.squareFootage),
      yearBuilt: num(item.yearBuilt),
      propertyType: str(item.propertyType),
      distance: num(item.distance),
      correlation,
      daysOnMarket: num(item.daysOnMarket),
      daysOld: num(item.daysOld),
      status: str(item.status),
      listedDate: str(item.listedDate),
      removedDate: str(item.removedDate),
      listingType: str(item.listingType),
    });
  }

  return out.sort((a, b) => b.correlation - a.correlation);
}

/** Top N by correlation — the comps table shows 10. */
export function topComparables(raw: unknown[] | undefined, n = 10): RentComparable[] {
  return parseComparables(raw).slice(0, n);
}
