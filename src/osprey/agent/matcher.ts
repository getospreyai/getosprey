import type { RentCastListing } from '../engine/index';
import { mapPropertyType } from '../engine/index';
import type { BuyBox, Dealbreakers } from './model';

/** Does a listing fall inside an investor's buy box, and clear their dealbreakers? */
export function matchesBuyBox(
  listing: RentCastListing,
  box: BuyBox,
  dealbreakers?: Dealbreakers,
): boolean {
  const type = mapPropertyType(listing);
  if (!type || !box.propertyTypes.includes(type)) return false;

  const price = listing.price ?? 0;
  if (price <= 0) return false;
  if (box.minPrice != null && price < box.minPrice) return false;
  if (box.maxPrice != null && price > box.maxPrice) return false;

  if (box.states?.length) {
    const state = (listing.state ?? '').toUpperCase();
    if (!box.states.map((s) => s.toUpperCase()).includes(state)) return false;
  }
  if (box.cities?.length) {
    const city = (listing.city ?? '').toLowerCase();
    if (!box.cities.map((c) => c.toLowerCase()).includes(city)) return false;
  }
  if (box.zips?.length) {
    if (!box.zips.includes(listing.zipCode ?? '')) return false;
  }
  if (box.minBedrooms != null && (listing.bedrooms ?? 0) < box.minBedrooms) return false;
  if (
    box.maxDaysOnMarket != null &&
    listing.daysOnMarket != null &&
    listing.daysOnMarket > box.maxDaysOnMarket
  ) {
    return false;
  }

  // Dealbreakers: unlike the buy box, missing data fails OPEN (never reject
  // on a field RentCast didn't return) — same convention as maxDaysOnMarket
  // above.
  if (dealbreakers?.maxHoaMonthly != null) {
    const hoa = listing.hoa?.fee ?? 0;
    if (hoa > dealbreakers.maxHoaMonthly) return false;
  }
  if (dealbreakers?.excludeZips?.length && listing.zipCode != null) {
    if (dealbreakers.excludeZips.includes(listing.zipCode)) return false;
  }
  if (
    dealbreakers?.minYearBuilt != null &&
    listing.yearBuilt != null &&
    listing.yearBuilt < dealbreakers.minYearBuilt
  ) {
    return false;
  }
  return true;
}
