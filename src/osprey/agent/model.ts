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
  /** Learned taste: pass reasons and preferences accumulated from the thread. */
  tasteNotes?: string[];
  /** When true, the loop logs verdicts to the ledger but never texts. */
  alertsPaused?: boolean;
}
