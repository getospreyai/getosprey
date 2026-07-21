-- Osprey waitlist schema (Neon / Postgres)
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS waitlist (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name        TEXT NOT NULL,
  email       TEXT NOT NULL,
  phone       TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One signup per email (case-insensitive).
CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique
  ON waitlist (lower(email));

-- ---------------------------------------------------------------------------
-- Multi-tenant SaaS schema (phase 1 — auth + agent runtime).
-- Mirrors src/lib/db.ts ensureSchema(). Safe to run repeatedly.
-- ---------------------------------------------------------------------------

-- gen_random_uuid() is built into Postgres core since v13 (no pgcrypto needed).
CREATE TABLE IF NOT EXISTS users (
  id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email         TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  name          TEXT NOT NULL,
  created_at    TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS investor_profiles (
  user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  profile           JSONB NOT NULL,
  telegram_chat_id  BIGINT UNIQUE,
  updated_at        TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS verdicts (
  id          BIGSERIAL PRIMARY KEY,
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL,
  record      JSONB NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS verdicts_user_created_idx
  ON verdicts (user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS seen_listings (
  listing_id  TEXT PRIMARY KEY,
  seen_at     TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tg_anchors (
  chat_id     BIGINT NOT NULL,
  message_id  BIGINT NOT NULL,
  listing_id  TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (chat_id, message_id)
);

-- ---------------------------------------------------------------------------
-- Property Files v1 (phase 1). Mirrors src/lib/db.ts ensureSchema().
-- ---------------------------------------------------------------------------

-- Raw RentCast payloads persisted at scan time so every property feature can
-- re-run the engine on demand without re-hitting the paid AVM/listing APIs.
CREATE TABLE IF NOT EXISTS listing_snapshots (
  listing_id  TEXT PRIMARY KEY,
  listing     JSONB NOT NULL,        -- RentCastListing verbatim
  rent        JSONB,                 -- RentCastRentEstimate verbatim (incl. comparables)
  captured_at TIMESTAMPTZ DEFAULT now()
);

-- On-demand LLM research reports, cached forever after first generation.
CREATE TABLE IF NOT EXISTS property_reports (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'generating',  -- 'generating' | 'ready' | 'failed'
  report      JSONB,                 -- structured report; null while generating
  model       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

-- Read-only public share tokens a realtor forwards to a client.
CREATE TABLE IF NOT EXISTS share_links (
  token       TEXT PRIMARY KEY,      -- crypto.randomUUID() without dashes
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
