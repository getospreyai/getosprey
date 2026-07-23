// Shared profile-settings validation + merge logic. Used by the settings
// PATCH route (src/app/api/profile/route.ts) and the onboarding wizard's
// completion route (src/app/api/onboarding/complete/route.ts) so both accept
// exactly the same shape and merge the same way. id/name/telegramChatId
// always come from the stored profile — the client can never touch them
// (zod strips unknown keys, and the merge below only reads the specific
// fields it allows). dealbreakers/tasteNotes/buyBox.states are user-editable
// but OPTIONAL in the payload: omitting any of them leaves the stored value
// untouched, so older clients that don't send them can't wipe them out.

import { z } from "zod";
import type { InvestorProfile } from "@/osprey/agent/model";

export const PropertyTypeSchema = z.enum([
  "single_family",
  "duplex",
  "triplex",
  "fourplex",
]);

const ConventionalSchema = z.object({
  kind: z.literal("conventional"),
  label: z.string().max(80).optional(),
  rate: z.number().min(0).max(0.2),
  downPct: z.number().min(0).max(1),
  termYears: z.number().min(1).max(40).optional(),
  pmiAnnualPct: z.number().min(0).max(0.1).optional(),
});

const FhaSchema = z.object({
  kind: z.literal("fha"),
  label: z.string().max(80).optional(),
  rate: z.number().min(0).max(0.2),
  downPct: z.number().min(0).max(1).optional(),
  termYears: z.number().min(1).max(40).optional(),
  ufmipPct: z.number().min(0).max(0.1).optional(),
  financeUfmip: z.boolean().optional(),
  annualMipPct: z.number().min(0).max(0.1).optional(),
  ownerOccupiedUnit: z.number().min(1).max(4).optional(),
});

const DscrSchema = z.object({
  kind: z.literal("dscr"),
  label: z.string().max(80).optional(),
  rate: z.number().min(0).max(0.2),
  downPct: z.number().min(0).max(1),
  termYears: z.number().min(1).max(40).optional(),
  interestOnly: z.boolean().optional(),
  minDscr: z.number().min(0).max(3).optional(),
});

const CashSchema = z.object({
  kind: z.literal("cash"),
  label: z.string().max(80).optional(),
});

export const FinancingProfileSchema = z.discriminatedUnion("kind", [
  ConventionalSchema,
  FhaSchema,
  DscrSchema,
  CashSchema,
]);

/** Partial overrides on the engine's Assumptions — mirrors the engine's
 *  `Assumptions` type. Every field is optional so scenario callers can override
 *  just the assumptions they care about; the engine fills the rest from
 *  STANDARD_ASSUMPTIONS. Percentages are decimals (0.05 = 5%). */
export const AssumptionsSchema = z
  .object({
    vacancyPct: z.number().min(0).max(1),
    maintenancePct: z.number().min(0).max(1),
    capexPct: z.number().min(0).max(1),
    managementPct: z.number().min(0).max(1),
    purchaseClosingPct: z.number().min(0).max(1),
    sellingCostPct: z.number().min(0).max(1),
    utilitiesMonthly: z.number().min(0).max(100_000),
    otherMonthlyExpense: z.number().min(0).max(100_000),
    taxRatePct: z.number().min(0).max(1),
    insuranceRatePct: z.number().min(0).max(1),
    annualAppreciationPct: z.number().min(-1).max(1),
    annualIncomeGrowthPct: z.number().min(-1).max(1),
    annualExpenseGrowthPct: z.number().min(-1).max(1),
  })
  .partial();

/** Mirrors the engine's Dealbreakers type. Whole-object replace when present
 *  (like buyBox) — null sub-fields mean "not set," not "leave unchanged." */
export const DealbreakersSchema = z.object({
  maxHoaMonthly: z.number().min(0).max(100_000).nullable(),
  excludeZips: z.array(z.string().min(1).max(10)).max(200),
  minYearBuilt: z.number().min(1700).max(2100).nullable(),
});

export const PatchProfileSchema = z.object({
  buyBox: z.object({
    cities: z.array(z.string().min(1).max(80)).max(50),
    /** Optional so callers that don't send it (e.g. the settings form today)
     *  leave the stored market untouched — same never-clobber pattern as
     *  dealbreakers/tasteNotes below. */
    states: z.array(z.string().length(2)).max(50).optional(),
    minPrice: z.number().min(0).max(100_000_000).nullable(),
    maxPrice: z.number().min(0).max(100_000_000).nullable(),
    propertyTypes: z.array(PropertyTypeSchema).min(1),
    maxDaysOnMarket: z.number().min(0).max(3650).nullable(),
  }),
  minMonthlyCashFlow: z.number().min(-100_000).max(100_000),
  alertsPaused: z.boolean(),
  financingProfiles: z.array(FinancingProfileSchema).min(1),
  /** Optional so older/partial clients that don't send it leave dealbreakers untouched. */
  dealbreakers: DealbreakersSchema.optional(),
  /** Optional for the same reason; editable now (settings UI lands in P2). */
  tasteNotes: z.array(z.string().min(1).max(280)).max(50).optional(),
});

export type PatchProfileData = z.infer<typeof PatchProfileSchema>;

/** Merge validated settings-form data onto a stored profile. Never touches
 *  id/name/telegramChatId/onboarded/initialScanAt. dealbreakers/tasteNotes
 *  only change when the payload includes them — omitted means "unchanged,"
 *  not "clear." */
export function mergeProfileSettings(
  stored: InvestorProfile,
  data: PatchProfileData,
): InvestorProfile {
  return {
    ...stored,
    buyBox: {
      ...stored.buyBox,
      cities: data.buyBox.cities,
      states: data.buyBox.states ?? stored.buyBox.states,
      minPrice: data.buyBox.minPrice ?? undefined,
      maxPrice: data.buyBox.maxPrice ?? undefined,
      propertyTypes: data.buyBox.propertyTypes,
      maxDaysOnMarket: data.buyBox.maxDaysOnMarket ?? undefined,
    },
    minMonthlyCashFlow: data.minMonthlyCashFlow,
    alertsPaused: data.alertsPaused,
    financingProfiles: data.financingProfiles,
    dealbreakers: data.dealbreakers
      ? {
          maxHoaMonthly: data.dealbreakers.maxHoaMonthly ?? undefined,
          excludeZips: data.dealbreakers.excludeZips,
          minYearBuilt: data.dealbreakers.minYearBuilt ?? undefined,
        }
      : stored.dealbreakers,
    tasteNotes: data.tasteNotes ?? stored.tasteNotes,
  };
}
