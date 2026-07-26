// One definition of "will the daily scan actually look at this profile?"
//
// This predicate was inline in the cron route (src/app/api/cron/scan/route.ts),
// which made a profile that silently never scans indistinguishable from one
// that scans and finds nothing. That is tolerable when every profile is created
// by the onboarding wizard; it is a real failure mode once an AGENT creates
// profiles on a client's behalf, because the client just sees silence forever
// and nobody gets an error.
//
// Exported so the cron and the UI share one source of truth: the cron filters
// on `ok`, and any surface listing profiles can render `reason` verbatim
// ("Not scanning — no financing profile set") instead of showing nothing.
//
// Behavior is intentionally identical to the original inline filter:
//   p.onboarded !== false && p.financingProfiles.length > 0 && p.buyBox.propertyTypes.length > 0

import type { InvestorProfile } from "./model";

export type Scannable =
  | { ok: true }
  | { ok: false; code: ScanBlockCode; reason: string };

export type ScanBlockCode = "onboarding_incomplete" | "no_financing" | "no_property_types";

/**
 * Whether the daily scan will consider this profile, and if not, why.
 *
 * `onboarded === false` is explicitly mid-wizard. `undefined` covers
 * legacy/CLI profiles that predate the onboarding flag and are treated as
 * onboarded — do not tighten this to `=== true` without a migration.
 */
export function isScannable(profile: InvestorProfile): Scannable {
  if (profile.onboarded === false) {
    return {
      ok: false,
      code: "onboarding_incomplete",
      reason: "Setup isn’t finished — the buy box hasn’t been completed yet.",
    };
  }
  if (profile.financingProfiles.length === 0) {
    return {
      ok: false,
      code: "no_financing",
      reason: "No financing profile set — there’s nothing to underwrite against.",
    };
  }
  if (profile.buyBox.propertyTypes.length === 0) {
    return {
      ok: false,
      code: "no_property_types",
      reason: "No property types selected — every listing is filtered out.",
    };
  }
  return { ok: true };
}

/** Convenience for the scan's filter step. */
export function scannableProfiles(profiles: InvestorProfile[]): InvestorProfile[] {
  return profiles.filter((p) => isScannable(p).ok);
}
