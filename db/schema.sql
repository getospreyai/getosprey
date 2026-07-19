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
