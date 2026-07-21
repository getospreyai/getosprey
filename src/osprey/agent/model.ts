// The Investor model: one structured record per user. This is Osprey's
// memory — the buy box, financing profiles, assumptions and alert threshold.
// Learned taste (from passes/replies) lands here in stage 4.

import type { Assumptions, FinancingProfile, PropertyType } from '../engine/index';

export interface BuyBox {
  /** Two-letter state codes, e.g. ["NV"]. */
  states?: string[];
  /** Case-insensitive city names; empty/omitted = whole state. */
  cities?: string[];
  zips?: string[];
  propertyTypes: PropertyType[];
  minPrice?: number;
  maxPrice?: number;
  minBedrooms?: number;
  /** Ignore listings older than this many days when scanning. */
  maxDaysOnMarket?: number;
}

export interface Dealbreakers {
  /** Reject listings whose HOA fee exceeds this monthly dollar amount. */
  maxHoaMonthly?: number;
  /** Reject listings in these zip codes. */
  excludeZips?: string[];
  /** Reject listings built before this year. */
  minYearBuilt?: number;
}

export interface InvestorProfile {
  id: string;
  name: string;
  /** E.164, for the eventual SMS channel (post-MVP; Telegram is the MVP channel). */
  phone?: string | null;
  /** Telegram chat id, bound when the user opens t.me/<bot>?start=<id>. */
  telegramChatId?: number | null;
  buyBox: BuyBox;
  /** One or more; every matching listing is underwritten at each. */
  financingProfiles: FinancingProfile[];
  /** Market/user overrides on the standard assumptions. */
  assumptions?: Partial<Assumptions>;
  /** The alert gate: minimum monthly cash flow (at any financing profile) to notify. */
  minMonthlyCashFlow: number;
  /** Hard filters enforced alongside the buy box — a match on paper that
   *  fails any of these never reaches underwriting. */
  dealbreakers?: Dealbreakers;
  /** Learned taste: pass reasons and preferences accumulated from the thread. */
  tasteNotes?: string[];
  /** When true, the loop logs verdicts to the ledger but never texts. */
  alertsPaused?: boolean;
  /** False until the onboarding wizard completes. Undefined (CLI/file
   *  profiles predating this field) is treated as onboarded. */
  onboarded?: boolean;
  /** ISO timestamp of the onboarding wizard's first scan, set once. */
  initialScanAt?: string;
  /** ISO timestamp of the last Sunday digest sent to this investor. Written
   *  via saveProfileSettings (never touches telegramChatId) by the cron
   *  route's digest step. Undefined = never sent. */
  lastDigestAt?: string;
}
