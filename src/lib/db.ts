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

  // Price-change timeline, written by the (dormant, RENTCAST_ENABLED-gated)
  // price-cut re-underwrite path. `kind` is 'price_change' today; leaves
  // room for other listing_snapshots-derived events later.
  await sql`
    CREATE TABLE IF NOT EXISTS listing_events (
      id          BIGSERIAL PRIMARY KEY,
      listing_id  TEXT NOT NULL,
      kind        TEXT NOT NULL,
      old_price   NUMERIC,
      new_price   NUMERIC,
      created_at  TIMESTAMPTZ DEFAULT now()
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS listing_events_listing_idx
      ON listing_events (listing_id)
  `;

  // One row per daily cron scan — the Sunday digest's "last 7 days" input.
  // Written only on the RENTCAST_ENABLED path; the disabled path writes
  // nothing here, same as everywhere else RentCast-gated.
  await sql`
    CREATE TABLE IF NOT EXISTS scan_runs (
      id            BIGSERIAL PRIMARY KEY,
      ran_at        TIMESTAMPTZ DEFAULT now(),
      city          TEXT,
      state         TEXT,
      scanned       INT NOT NULL DEFAULT 0,
      in_niche      INT NOT NULL DEFAULT 0,
      matched       INT NOT NULL DEFAULT 0,
      underwritten  INT NOT NULL DEFAULT 0,
      texts         INT NOT NULL DEFAULT 0,
      price_changes INT NOT NULL DEFAULT 0
    )
  `;

  // Scan coverage. The market cap (OSPREY_MAX_MARKETS) drops markets past the
  // limit, and every profile that only targets a dropped market goes unscanned
  // that run — previously visible only as a console.warn, i.e. effectively not
  // at all. Recording it makes "why does this investor never get alerts?"
  // answerable from the database.
  //
  // NOTE: these are the first ALTERs in ensureSchema (every prior statement is
  // CREATE TABLE IF NOT EXISTS, which does NOT add columns to an existing
  // table). Deliberately chosen to land on scan_runs first: it is an
  // append-only stats table, tiny, holds no user data, and the columns are
  // nullable — so this doubles as a low-risk production rehearsal of the ALTER
  // path that the users-table migration will need later.
  await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_requested INT`;
  await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_scanned INT`;
  await sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_dropped JSONB`;

  // -------------------------------------------------------------------------
  // Agent accounts, phase 0 (2026-07-26). See docs/AGENT-ACCOUNTS-PLAN.md.
  //
  // Existing rows are unaffected: role defaults to 'investor' and status to
  // 'active', which is exactly what every current user is.
  // -------------------------------------------------------------------------

  // 'investor' | 'agent' | 'brokerage_admin'
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'investor'`;
  // 'active' | 'managed' | 'invited'. A managed/invited client is a real user
  // row the agent manages; it has no password and MUST NOT be able to log in
  // (enforced in src/auth.ts authorize(), not by this column).
  await sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`;
  // Managed clients have no password. Postgres treats dropping a NOT NULL that
  // isn't there as a no-op, so this stays idempotent.
  await sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`;

  // The agent -> client roster. resolveScope() reads this on every
  // cross-user access, so an archived row immediately revokes the agent.
  await sql`
    CREATE TABLE IF NOT EXISTS agent_clients (
      agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      label          TEXT,
      alerts_live    BOOLEAN NOT NULL DEFAULT false,
      created_at     TIMESTAMPTZ DEFAULT now(),
      archived_at    TIMESTAMPTZ,
      PRIMARY KEY (agent_user_id, client_user_id)
    )
  `;

  await sql`
    CREATE INDEX IF NOT EXISTS agent_clients_client_idx
      ON agent_clients (client_user_id)
  `;

  schemaReady = true;
}
