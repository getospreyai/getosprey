import { neon } from "@neondatabase/serverless";

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

// Reuse the SQL client across warm invocations.
export const sql = connectionString ? neon(connectionString) : null;

/** True when DATABASE_URL (or POSTGRES_URL) is configured for this runtime. */
export function hasDb(): boolean {
  return sql !== null;
}

// Ensure the multi-tenant schema exists. Runs once per cold start.
let schemaReady = false;
export async function ensureSchema(): Promise<void> {
  if (schemaReady) return;
  if (!sql) {
    throw new Error("ensureSchema: DATABASE_URL is not configured.");
  }

  // gen_random_uuid() is built into Postgres core since v13 (no pgcrypto needed).
  await sql`
    CREATE TABLE IF NOT EXISTS users (
      id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email         TEXT UNIQUE NOT NULL,
      password_hash TEXT NOT NULL,
      name          TEXT NOT NULL,
      created_at    TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS investor_profiles (
      user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
      profile            JSONB NOT NULL,
      telegram_chat_id  BIGINT UNIQUE,
      updated_at        TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS verdicts (
      id          BIGSERIAL PRIMARY KEY,
      user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
      listing_id  TEXT NOT NULL,
      record      JSONB NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS verdicts_user_created_idx
      ON verdicts (user_id, created_at DESC)
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS seen_listings (
      listing_id  TEXT PRIMARY KEY,
      seen_at     TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE TABLE IF NOT EXISTS tg_anchors (
      chat_id     BIGINT NOT NULL,
      message_id  BIGINT NOT NULL,
      listing_id  TEXT NOT NULL,
      created_at  TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (chat_id, message_id)
    )
  `;

  // Raw RentCast payloads persisted at scan time so every property feature can
  // re-run the engine on demand without re-hitting the paid AVM/listing APIs.
  await sql`
    CREATE TABLE IF NOT EXISTS listing_snapshots (
      listing_id  TEXT PRIMARY KEY,
      listing     JSONB NOT NULL,
      rent        JSONB,
      captured_at TIMESTAMPTZ DEFAULT now()
    )
  `;

  // On-demand LLM research reports, cached forever after first generation.
  await sql`
    CREATE TABLE IF NOT EXISTS property_reports (
      user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
      listing_id  TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'generating',
      report      JSONB,
      model       TEXT,
      created_at  TIMESTAMPTZ DEFAULT now(),
      updated_at  TIMESTAMPTZ DEFAULT now(),
      PRIMARY KEY (user_id, listing_id)
    )
  `;

  // Read-only public share tokens a realtor forwards to a client.
  await sql`
    CREATE TABLE IF NOT EXISTS share_links (
      token       TEXT PRIMARY KEY,
      user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
      listing_id  TEXT NOT NULL,
      revoked     BOOLEAN NOT NULL DEFAULT false,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `;

  schemaReady = true;
}
