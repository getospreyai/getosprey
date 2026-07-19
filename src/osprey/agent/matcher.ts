import type { RentCastListing } from '../engine/index';
import { mapPropertyType } from '../engine/index';
import type { BuyBox } from './model';

/** Does a listing fall inside an investor's buy box? */
export function matchesBuyBox(listing: RentCastListing, box: BuyBox): boolean {
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
  return true;
}
