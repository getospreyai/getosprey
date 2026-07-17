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
