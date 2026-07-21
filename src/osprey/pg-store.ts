// PgStore: the Store interface (src/osprey/agent/store.ts) implemented
// against Neon Postgres. respond()/telegram.ts/runScan never know they're
// talking to Postgres instead of the CLI's FileStore.
//
// Follows the lazy-client pattern in src/lib/db.ts: `sql` is null until
// DATABASE_URL is configured, so importing this module (e.g. at Next.js
// build time with no env vars) never throws — only calling a method does.

import { sql } from "@/lib/db";
import type { Store } from "./agent/store";
import type { InvestorProfile } from "./agent/model";
import type { VerdictRecord } from "./agent/loop";
import type { RentCastListing, RentCastRentEstimate } from "./engine";

type Sql = NonNullable<typeof sql>;

function requireSql(): Sql {
  if (!sql) throw new Error("PgStore: DATABASE_URL is not configured.");
  return sql;
}

/** A persisted RentCast payload pair captured at scan time. */
export interface ListingSnapshot {
  listing: RentCastListing;
  /** Null when the AVM had no usable estimate at capture time. */
  rent: RentCastRentEstimate | null;
  capturedAt: string;
}

export type ReportStatus = "generating" | "ready" | "failed";

/** A property_reports row. `report` is null until status becomes 'ready'. */
export interface ReportRow<T = unknown> {
  status: ReportStatus;
  report: T | null;
  model: string | null;
  createdAt: string;
  updatedAt: string;
}

/** A share_links row. */
export interface ShareLinkRow {
  token: string;
  userId: string;
  listingId: string;
  revoked: boolean;
  createdAt: string;
}

/** Old vs new price captured by a diff-aware saveSnapshot() call. */
export interface PriceChangeInfo {
  oldPrice: number;
  newPrice: number;
}

/** A listing_events row (property-page price-history timeline). */
export interface ListingEventRow {
  id: number;
  listingId: string;
  kind: string;
  oldPrice: number | null;
  newPrice: number | null;
  createdAt: string;
}

/** One scan_runs row — a single daily cron invocation's tallies. */
export interface ScanRunStats {
  city: string;
  state: string;
  scanned: number;
  inNiche: number;
  matched: number;
  underwritten: number;
  texts: number;
  priceChanges: number;
}

/** scan_runs rows summed over a window — the Sunday digest's market-wide input. */
export interface ScanRunTotals {
  scanned: number;
  priceChanges: number;
  /** Row count in the window. Zero means the scan was dormant all week
   *  (RENTCAST_ENABLED off, or genuinely no cron ran) — the digest builder
   *  treats that as "stay silent," not "report zeros." */
  runCount: number;
}

interface ProfileRow {
  user_id: string;
  profile: Record<string, unknown>;
  telegram_chat_id: number | string | null;
}

/** Merge the jsonb profile blob + telegram_chat_id column into an InvestorProfile. */
function toProfile(row: ProfileRow): InvestorProfile {
  return {
    ...(row.profile as object),
    id: row.user_id,
    telegramChatId: row.telegram_chat_id == null ? null : Number(row.telegram_chat_id),
  } as InvestorProfile;
}

export class PgStore implements Store {
  async loadProfile(userId: string): Promise<InvestorProfile | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT user_id, profile, telegram_chat_id
      FROM investor_profiles
      WHERE user_id = ${userId}
    `) as ProfileRow[];
    const row = rows[0];
    return row ? toProfile(row) : null;
  }

  async saveProfile(profile: InvestorProfile): Promise<void> {
    const db = requireSql();
    // telegramChatId lives in its own column, not the jsonb blob.
    const { telegramChatId, ...rest } = profile;
    await db`
      INSERT INTO investor_profiles (user_id, profile, telegram_chat_id, updated_at)
      VALUES (${profile.id}, ${JSON.stringify(rest)}::jsonb, ${telegramChatId ?? null}, now())
      ON CONFLICT (user_id) DO UPDATE
        SET profile = EXCLUDED.profile,
            telegram_chat_id = EXCLUDED.telegram_chat_id,
            updated_at = now()
    `;
  }

  /**
   * Update the profile blob WITHOUT touching telegram_chat_id. That column is
   * owned by the webhook's /start binding — a settings save racing a fresh
   * binding must never clobber it back to null. Web routes (settings PATCH,
   * onboarding complete) use this; saveProfile remains for the agent paths
   * that legitimately carry the chat id.
   */
  async saveProfileSettings(profile: InvestorProfile): Promise<void> {
    const db = requireSql();
    const { telegramChatId: _ignored, ...rest } = profile;
    void _ignored;
    await db`
      UPDATE investor_profiles
      SET profile = ${JSON.stringify(rest)}::jsonb, updated_at = now()
      WHERE user_id = ${profile.id}
    `;
  }

  async findProfileByChatId(chatId: number): Promise<InvestorProfile | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT user_id, profile, telegram_chat_id
      FROM investor_profiles
      WHERE telegram_chat_id = ${chatId}
    `) as ProfileRow[];
    const row = rows[0];
    return row ? toProfile(row) : null;
  }

  async loadRecentVerdicts<T extends { investorId: string }>(
    userId: string,
    limit = 5,
  ): Promise<T[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT record
      FROM verdicts
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
      LIMIT ${limit}
    `) as { record: T }[];
    return rows.map((r) => r.record);
  }

  /**
   * This investor's verdicts created since `since`, newest first. Distinct
   * from loadRecentVerdicts (which caps by row COUNT): the Sunday digest
   * needs an accurate 7-day window regardless of how many verdicts landed —
   * a busy week could exceed any fixed limit, a quiet week could span more
   * than N rows back. Bounded at 500 as a sanity cap, not a real limit for
   * one investor's weekly volume.
   */
  async loadVerdictsSince(userId: string, since: Date): Promise<VerdictRecord[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT record
      FROM verdicts
      WHERE user_id = ${userId} AND created_at >= ${since.toISOString()}
      ORDER BY created_at DESC
      LIMIT 500
    `) as { record: VerdictRecord }[];
    return rows.map((r) => r.record);
  }

  async appendVerdict(record: VerdictRecord): Promise<void> {
    const db = requireSql();
    await db`
      INSERT INTO verdicts (user_id, listing_id, record)
      VALUES (${record.investorId}, ${record.listingId}, ${JSON.stringify(record)}::jsonb)
    `;
  }

  async saveTgAnchor(chatId: number, messageId: number, listingId: string): Promise<void> {
    const db = requireSql();
    await db`
      INSERT INTO tg_anchors (chat_id, message_id, listing_id)
      VALUES (${chatId}, ${messageId}, ${listingId})
      ON CONFLICT (chat_id, message_id) DO UPDATE SET listing_id = EXCLUDED.listing_id
    `;
  }

  async loadTgAnchor(chatId: number, messageId: number): Promise<string | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT listing_id
      FROM tg_anchors
      WHERE chat_id = ${chatId} AND message_id = ${messageId}
    `) as { listing_id: string }[];
    return rows[0]?.listing_id ?? null;
  }

  // --- Cron-scan helpers (not part of the shared Store interface) ----------

  /** Every investor profile, for the daily scan's buy-box matching pass. */
  async loadAllProfiles(): Promise<InvestorProfile[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT user_id, profile, telegram_chat_id FROM investor_profiles
    `) as ProfileRow[];
    return rows.map(toProfile);
  }

  /** Of the given listing ids, the ones NOT already in seen_listings. */
  async filterUnseen(ids: string[]): Promise<Set<string>> {
    if (ids.length === 0) return new Set();
    const db = requireSql();
    const rows = (await db`
      SELECT listing_id FROM seen_listings WHERE listing_id = ANY(${ids}::text[])
    `) as { listing_id: string }[];
    const alreadySeen = new Set(rows.map((r) => r.listing_id));
    return new Set(ids.filter((id) => !alreadySeen.has(id)));
  }

  /** Record listing ids as scanned so future batches skip them. */
  async markSeen(ids: string[]): Promise<void> {
    if (ids.length === 0) return;
    const db = requireSql();
    await db`
      INSERT INTO seen_listings (listing_id)
      SELECT unnest(${ids}::text[])
      ON CONFLICT (listing_id) DO NOTHING
    `;
  }

  // --- Listing snapshots ---------------------------------------------------

  /**
   * Persist the raw RentCast payloads for a matched listing (upsert on
   * re-scan). Diff-aware: when a prior snapshot exists and its price
   * differs from the incoming listing's price, records a `price_change`
   * listing_events row and returns the old/new prices — the price-cut
   * re-underwrite path (cron route) reacts to that return value. Returns
   * null on a first-time snapshot or when the price didn't move.
   */
  async saveSnapshot(
    listingId: string,
    listing: RentCastListing,
    rent: RentCastRentEstimate | null,
  ): Promise<{ priceChange: PriceChangeInfo } | null> {
    const db = requireSql();

    const existingRows = (await db`
      SELECT listing FROM listing_snapshots WHERE listing_id = ${listingId}
    `) as { listing: RentCastListing }[];
    const oldPrice = existingRows[0]?.listing?.price;
    const newPrice = listing.price;

    let priceChange: PriceChangeInfo | null = null;
    if (oldPrice != null && newPrice != null && oldPrice !== newPrice) {
      priceChange = { oldPrice, newPrice };
      await db`
        INSERT INTO listing_events (listing_id, kind, old_price, new_price)
        VALUES (${listingId}, 'price_change', ${oldPrice}, ${newPrice})
      `;
    }

    await db`
      INSERT INTO listing_snapshots (listing_id, listing, rent, captured_at)
      VALUES (${listingId}, ${JSON.stringify(listing)}::jsonb, ${
        rent ? JSON.stringify(rent) : null
      }::jsonb, now())
      ON CONFLICT (listing_id) DO UPDATE
        SET listing = EXCLUDED.listing,
            rent = EXCLUDED.rent,
            captured_at = now()
    `;

    return priceChange ? { priceChange } : null;
  }

  /** Price-change timeline for one listing, newest first (property-page use). */
  async loadEventsForListing(listingId: string): Promise<ListingEventRow[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT id, listing_id, kind, old_price, new_price, created_at
      FROM listing_events
      WHERE listing_id = ${listingId}
      ORDER BY created_at DESC
    `) as {
      id: number;
      listing_id: string;
      kind: string;
      old_price: string | number | null;
      new_price: string | number | null;
      created_at: string;
    }[];
    return rows.map((r) => ({
      id: r.id,
      listingId: r.listing_id,
      kind: r.kind,
      // NUMERIC columns can come back as strings — coerce either way.
      oldPrice: r.old_price == null ? null : Number(r.old_price),
      newPrice: r.new_price == null ? null : Number(r.new_price),
      createdAt: r.created_at,
    }));
  }

  /** Record one daily cron scan's tallies (Sunday-digest input). */
  async recordScanRun(stats: ScanRunStats): Promise<void> {
    const db = requireSql();
    await db`
      INSERT INTO scan_runs (city, state, scanned, in_niche, matched, underwritten, texts, price_changes)
      VALUES (${stats.city}, ${stats.state}, ${stats.scanned}, ${stats.inNiche}, ${stats.matched},
              ${stats.underwritten}, ${stats.texts}, ${stats.priceChanges})
    `;
  }

  /**
   * scan_runs summed over a window — the Sunday digest's "84 listings
   * scanned" / "3 price cuts tracked" figures. No existing method aggregates
   * scan_runs at all (recordScanRun only writes); this is a genuinely new
   * read, not a substitute for a limit-based one.
   */
  async loadScanRunTotalsSince(since: Date): Promise<ScanRunTotals> {
    const db = requireSql();
    const rows = (await db`
      SELECT
        COALESCE(SUM(scanned), 0)::int AS scanned,
        COALESCE(SUM(price_changes), 0)::int AS price_changes,
        COUNT(*)::int AS run_count
      FROM scan_runs
      WHERE ran_at >= ${since.toISOString()}
    `) as { scanned: number; price_changes: number; run_count: number }[];
    const row = rows[0];
    return {
      scanned: row?.scanned ?? 0,
      priceChanges: row?.price_changes ?? 0,
      runCount: row?.run_count ?? 0,
    };
  }

  async loadSnapshot(listingId: string): Promise<ListingSnapshot | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT listing, rent, captured_at
      FROM listing_snapshots
      WHERE listing_id = ${listingId}
    `) as { listing: RentCastListing; rent: RentCastRentEstimate | null; captured_at: string }[];
    const row = rows[0];
    if (!row) return null;
    return { listing: row.listing, rent: row.rent, capturedAt: row.captured_at };
  }

  /** Newest verdict for this (user, listing) pair — the authorization gate for
   *  property features: you only model properties from your own feed. */
  async loadVerdictForListing(
    userId: string,
    listingId: string,
  ): Promise<VerdictRecord | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT record
      FROM verdicts
      WHERE user_id = ${userId} AND listing_id = ${listingId}
      ORDER BY created_at DESC
      LIMIT 1
    `) as { record: VerdictRecord }[];
    return rows[0]?.record ?? null;
  }

  // --- Property reports ----------------------------------------------------

  async getReport<T = unknown>(
    userId: string,
    listingId: string,
  ): Promise<ReportRow<T> | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT status, report, model, created_at, updated_at
      FROM property_reports
      WHERE user_id = ${userId} AND listing_id = ${listingId}
    `) as {
      status: ReportStatus;
      report: T | null;
      model: string | null;
      created_at: string;
      updated_at: string;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      status: row.status,
      report: row.report,
      model: row.model,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  /** Mark a report as generating (claims the slot; clears any prior payload). */
  async upsertReportGenerating(userId: string, listingId: string): Promise<void> {
    const db = requireSql();
    await db`
      INSERT INTO property_reports (user_id, listing_id, status, report, model, updated_at)
      VALUES (${userId}, ${listingId}, 'generating', NULL, NULL, now())
      ON CONFLICT (user_id, listing_id) DO UPDATE
        SET status = 'generating',
            report = NULL,
            model = NULL,
            updated_at = now()
    `;
  }

  async saveReportReady(
    userId: string,
    listingId: string,
    report: unknown,
    model: string,
  ): Promise<void> {
    const db = requireSql();
    await db`
      UPDATE property_reports
      SET status = 'ready', report = ${JSON.stringify(report)}::jsonb,
          model = ${model}, updated_at = now()
      WHERE user_id = ${userId} AND listing_id = ${listingId}
    `;
  }

  async markReportFailed(userId: string, listingId: string): Promise<void> {
    const db = requireSql();
    await db`
      UPDATE property_reports
      SET status = 'failed', updated_at = now()
      WHERE user_id = ${userId} AND listing_id = ${listingId}
    `;
  }

  /** Count report generations for a user since `since` — the rate-limit input. */
  async countReportsSince(userId: string, since: Date): Promise<number> {
    const db = requireSql();
    const rows = (await db`
      SELECT count(*)::int AS n
      FROM property_reports
      WHERE user_id = ${userId} AND updated_at >= ${since.toISOString()}
    `) as { n: number }[];
    return rows[0]?.n ?? 0;
  }

  // --- Share links ---------------------------------------------------------

  /** Return the existing non-revoked token for this pair, or mint a new one. */
  async createShareLink(userId: string, listingId: string): Promise<string> {
    const db = requireSql();
    const existing = (await db`
      SELECT token
      FROM share_links
      WHERE user_id = ${userId} AND listing_id = ${listingId} AND revoked = false
      ORDER BY created_at DESC
      LIMIT 1
    `) as { token: string }[];
    if (existing[0]) return existing[0].token;

    const token = crypto.randomUUID().replace(/-/g, "");
    await db`
      INSERT INTO share_links (token, user_id, listing_id)
      VALUES (${token}, ${userId}, ${listingId})
    `;
    return token;
  }

  async loadShareLink(token: string): Promise<ShareLinkRow | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT token, user_id, listing_id, revoked, created_at
      FROM share_links
      WHERE token = ${token}
    `) as {
      token: string;
      user_id: string;
      listing_id: string;
      revoked: boolean;
      created_at: string;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      token: row.token,
      userId: row.user_id,
      listingId: row.listing_id,
      revoked: row.revoked,
      createdAt: row.created_at,
    };
  }

  /** Revoke every non-revoked token for this (user, listing) pair. */
  async revokeShareLink(userId: string, listingId: string): Promise<void> {
    const db = requireSql();
    await db`
      UPDATE share_links
      SET revoked = true
      WHERE user_id = ${userId} AND listing_id = ${listingId} AND revoked = false
    `;
  }

  async listShareLinks(userId: string): Promise<ShareLinkRow[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT token, user_id, listing_id, revoked, created_at
      FROM share_links
      WHERE user_id = ${userId}
      ORDER BY created_at DESC
    `) as {
      token: string;
      user_id: string;
      listing_id: string;
      revoked: boolean;
      created_at: string;
    }[];
    return rows.map((row) => ({
      token: row.token,
      userId: row.user_id,
      listingId: row.listing_id,
      revoked: row.revoked,
      createdAt: row.created_at,
    }));
  }
}
