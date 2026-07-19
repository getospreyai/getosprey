// The persistence seam the vendored agent core depends on. FileStore (the
// CLI harness in ../osprey-agent) and PgStore (src/osprey/pg-store.ts, this
// repo) both implement it — respond()/telegram.ts never know which.
// All methods are async: PgStore hits Neon over the network.

import type { InvestorProfile } from './model';
import type { VerdictRecord } from './loop';

export interface Store {
  loadProfile(id: string): Promise<InvestorProfile | null>;
  saveProfile(profile: InvestorProfile): Promise<void>;
  /** Most recent verdicts for one investor, newest first. */
  loadRecentVerdicts<T extends { investorId: string }>(
    investorId: string,
    limit?: number,
  ): Promise<T[]>;
  appendVerdict(record: VerdictRecord): Promise<void>;
  /** Telegram message anchors: a verdict card's buttons resolve to the deal
   *  they're attached to, not whatever arrived last. */
  saveTgAnchor(chatId: number, messageId: number, listingId: string): Promise<void>;
  loadTgAnchor(chatId: number, messageId: number): Promise<string | null>;
  /** Resolve an inbound Telegram chat to the investor profile bound to it. */
  findProfileByChatId(chatId: number): Promise<InvestorProfile | null>;
}
