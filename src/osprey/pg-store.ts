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

type Sql = NonNullable<typeof sql>;

function requireSql(): Sql {
  if (!sql) throw new Error("PgStore: DATABASE_URL is not configured.");
  return sql;
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
}
