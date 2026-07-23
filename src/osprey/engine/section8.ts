// Section 8 (Housing Choice Voucher) payment standards — Southern Nevada
// Regional Housing Authority (SNRHA), Clark County NV.
//
// This dataset is METRO-SPECIFIC (Las Vegas-Henderson-North Las Vegas MSA
// only). Osprey is nationwide now, so section8Standard() below is gated on
// state/city and returns null for anything outside this metro — a Phoenix
// or Atlanta property must never display SNRHA's numbers. Every other
// metro needs its own FMR table + its own gate before it can show a
// Section 8 standard at all.
//
// SNRHA sets payment standards METRO-WIDE (one schedule for the whole Las
// Vegas-Henderson-North Las Vegas MSA) at 110% of HUD's Fair Market Rent —
// NOT Small Area FMR / zip-based (Clark County isn't on HUD's mandatory
// SAFMR list). So this only needs a bedroom count, no zip.
//
// FMR base: HUD FY2026 Fair Market Rents, effective Oct 1, 2025 (current as
// of this wave, Jul 2026). High confidence — HUD's FMR Documentation System
// for the metro, cross-checked twice against Clark County's posted copy.
//   https://www.huduser.gov/portal/datasets/fmr/fmr2026/FY2026_FMR_Schedule.pdf
//   https://www.clarkcountynv.gov/assets/documents/residents/assistance_programs/fy-2026-fair-market-rent-documentation-system-calculation-for-las-vegas-henderson-n-las-vegas.pdf
//
// Payment-standard policy (110% of FMR): SNRHA does not publish a public
// per-bedroom dollar table — their site states the 110% policy and points
// landlords to the Landlord Liaison / RentCafe portal instead. So the
// standard is COMPUTED here (FMR * SNRHA_MULTIPLIER) rather than vendored as
// a fixed table, so it stays correct if HUD revises FMRs or SNRHA revises
// the multiplier — only the inputs below need updating.
//   https://www.snvrha.org/residents/housing-choice-voucher/hcv-rent-payments
//   https://www.snvrha.org/landlords/new-landlords
//
// Verify the exact current schedule with SNRHA directly: (702) 477-3100.

/** HUD FY2026 FMR by bedroom count, Las Vegas-Henderson-N. Las Vegas MSA. Index 0 = studio. */
const FY2026_FMR: readonly number[] = [1333, 1478, 1735, 2413, 2764];

/** SNRHA's stated payment-standard policy: 110% of FMR. */
export const SNRHA_MULTIPLIER = 1.1;

export interface Section8Standard {
  /** SNRHA's estimated HCV payment standard for this bedroom count, in dollars/month. */
  standard: number;
  /** UI disclosure — SNRHA publishes the 110%-of-FMR policy, not a dollar table. */
  label: string;
}

/** Clark County cities SNRHA's payment standard covers, beyond unincorporated
 *  Clark County itself (state === "NV" with no city, or an unrecognized
 *  city, still counts — the metro is most of the county). */
const LAS_VEGAS_METRO_CITIES = new Set(["las vegas", "north las vegas", "henderson"]);

/** Is this property inside the SNRHA (Las Vegas metro) service area? NV
 *  state is required; an unknown/omitted city is accepted (most of Clark
 *  County), but a named city outside the metro list is not. */
function isLasVegasMetro(state?: string, city?: string): boolean {
  if ((state ?? "").trim().toUpperCase() !== "NV") return false;
  const normalizedCity = (city ?? "").trim().toLowerCase();
  if (normalizedCity === "") return true;
  return LAS_VEGAS_METRO_CITIES.has(normalizedCity);
}

/**
 * SNRHA Housing Choice Voucher payment standard for a given bedroom count.
 * Metro-wide (Clark County NV) — no zip needed. Returns null for anything
 * outside the Las Vegas metro (see isLasVegasMetro) — this dataset does not
 * generalize to other markets — and null beyond 4BR: HUD/SNRHA publish 0-4BR
 * FMRs; larger units need a direct SNRHA quote.
 */
export function section8Standard(
  bedrooms: number,
  state?: string,
  city?: string,
): Section8Standard | null {
  if (!isLasVegasMetro(state, city)) return null;
  if (!Number.isFinite(bedrooms)) return null;
  const index = Math.round(bedrooms);
  if (index < 0 || index > 4) return null;

  const fmr = FY2026_FMR[index];
  return {
    standard: Math.round(fmr * SNRHA_MULTIPLIER),
    label: '≈110% of FY2026 FMR — verify with SNRHA',
  };
}
