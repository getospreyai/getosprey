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

-- ---------------------------------------------------------------------------
-- Wave 2 (2026-07-20): price-cut re-underwriting (dormant, RENTCAST_ENABLED-
-- gated) + scan stats. Mirrors src/lib/db.ts ensureSchema().
-- ---------------------------------------------------------------------------

-- Price-change timeline, written by the price-cut re-underwrite path.
-- `kind` is 'price_change' today; leaves room for other listing_snapshots-
-- derived events later.
CREATE TABLE IF NOT EXISTS listing_events (
  id          BIGSERIAL PRIMARY KEY,
  listing_id  TEXT NOT NULL,
  kind        TEXT NOT NULL,
  old_price   NUMERIC,
  new_price   NUMERIC,
  created_at  TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS listing_events_listing_idx
  ON listing_events (listing_id);

-- One row per daily cron scan — the Sunday digest's "last 7 days" input.
-- Written only on the RENTCAST_ENABLED path.
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
);

-- Scan coverage (2026-07-26). The OSPREY_MAX_MARKETS cap drops markets past
-- the limit; every profile that only targets a dropped market goes unscanned
-- that run. Recorded so that is diagnosable from SQL instead of a console.warn.
-- Separate ALTERs (not inlined above) because the CREATE TABLE IF NOT EXISTS
-- will not add columns to an already-existing scan_runs.
ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_requested INT;
ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_scanned   INT;
ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_dropped   JSONB;

-- ---------------------------------------------------------------------------
-- Agent accounts, phase 0 (2026-07-26). See docs/AGENT-ACCOUNTS-PLAN.md.
-- Mirrors src/lib/db.ts ensureSchema(). Existing rows are unaffected: role
-- defaults to 'investor' and status to 'active' — what every current user is.
-- ---------------------------------------------------------------------------

-- 'investor' | 'agent' | 'brokerage_admin'
ALTER TABLE users ADD COLUMN IF NOT EXISTS role   TEXT NOT NULL DEFAULT 'investor';
-- 'active' | 'managed' | 'invited'. A managed/invited client is a real user row
-- the agent manages; it has no password and must not be able to log in — that
-- is enforced in src/auth.ts authorize(), not by this column.
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
-- Managed clients have no password.
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;

-- The agent -> client roster. resolveScope() reads this on every cross-user
-- access, so setting archived_at immediately revokes the agent.
CREATE TABLE IF NOT EXISTS agent_clients (
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT,
  alerts_live    BOOLEAN NOT NULL DEFAULT false,
  created_at     TIMESTAMPTZ DEFAULT now(),
  archived_at    TIMESTAMPTZ,
  PRIMARY KEY (agent_user_id, client_user_id)
);

CREATE INDEX IF NOT EXISTS agent_clients_client_idx
  ON agent_clients (client_user_id);

-- A client belongs to at most ONE agent at a time. Without this, two agents
-- could each hold an active roster row for the same person and both read their
-- financial data, while the privacy copy promises the client that "your agent"
-- (singular) has access. Archived rows are excluded so a client can be handed
-- from one agent to another.
CREATE UNIQUE INDEX IF NOT EXISTS agent_clients_one_active_agent
  ON agent_clients (client_user_id) WHERE archived_at IS NULL;

-- The agent's declared farm markets. Client buy boxes must fall inside these
-- (see withinFarm), which keeps daily scan cost flat per agent regardless of
-- client count — each distinct market is its own full paginated RentCast pull.
CREATE TABLE IF NOT EXISTS agent_settings (
  agent_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  farm_markets  JSONB NOT NULL DEFAULT '[]'::jsonb,
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- The client's real contact address, kept OFF users.email deliberately. A
-- managed client's users.email is a synthetic placeholder, so adding a client
-- can never collide with an existing account — which would both fail
-- confusingly and turn client creation into an email-enumeration oracle.
ALTER TABLE agent_clients ADD COLUMN IF NOT EXISTS client_email TEXT;

-- Constrain the enum-ish columns. ADD CONSTRAINT has no IF NOT EXISTS.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'managed', 'invited'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
    ALTER TABLE users ADD CONSTRAINT users_role_check
      CHECK (role IN ('investor', 'agent', 'brokerage_admin'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Agent accounts, phase 2 (2026-07-27): invite links + claiming.
-- Mirrors src/lib/db.ts ensureSchema(). See docs/PHASE-2-INVITES-PLAN.md.
-- ---------------------------------------------------------------------------

-- Per-client invite tokens. The agent delivers the link themselves; Osprey
-- sends no email (AGENT-ACCOUNTS-PLAN.md §9).
--
-- token_hash, NOT the token. A raw invite token is a bearer credential for
-- becoming someone else's account, so anything that can read this table would
-- otherwise be account takeover for every outstanding invite. Plain sha256 is
-- correct here because the token is 256 bits of CSPRNG output — there is no
-- dictionary to attack, so the slow-hash argument for passwords does not apply.
CREATE TABLE IF NOT EXISTS client_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     TEXT NOT NULL UNIQUE,
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  accepted_at    TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_invites_agent_idx  ON client_invites (agent_user_id);
CREATE INDEX IF NOT EXISTS client_invites_client_idx ON client_invites (client_user_id);

-- At most one outstanding invite per client: every live token is an
-- independent theft target.
CREATE UNIQUE INDEX IF NOT EXISTS client_invites_one_outstanding
  ON client_invites (client_user_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;

-- The recorded consent required by ship gate #5. APPEND-ONLY: a withdrawal is
-- a new row (kind 'withdraw'), never an UPDATE, because "what did they agree
-- to, and when" is not a question a mutable row can answer after the fact.
-- `disclosure` holds the text shown verbatim — a pointer to copy in a .tsx
-- file is worthless once that copy changes.
-- Both user references are ON DELETE SET NULL, not CASCADE. Deleting an account
-- must erase the person, but this table's whole job is to answer "what did they
-- agree to, and when" — and a cascade answers it with silence exactly when
-- someone disputes that consent was ever obtained. Nulling the ids erases the
-- identifiers while keeping policy_version, disclosure, and created_at as an
-- anonymous record that A consent occurred. See docs/PRIVACY-TOS-AGENT-DRAFT.md
-- §A6; the retention window belongs in the policy's retention section.
CREATE TABLE IF NOT EXISTS client_consents (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID REFERENCES users(id) ON DELETE SET NULL,
  agent_user_id  UUID REFERENCES users(id) ON DELETE SET NULL,
  kind           TEXT NOT NULL,   -- 'agent_access' | 'withdraw'
  policy_version TEXT NOT NULL,   -- which text they agreed to
  disclosure     TEXT NOT NULL,   -- verbatim copy of the screen shown
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- No-ops on a database that created the table above. Present for dev databases
-- that already have the original NOT NULL/CASCADE definition, which
-- CREATE TABLE IF NOT EXISTS leaves alone. `confdeltype = 'c'` is the cascade
-- marker: this converts once, then stops matching.
ALTER TABLE client_consents ALTER COLUMN user_id       DROP NOT NULL;
ALTER TABLE client_consents ALTER COLUMN agent_user_id DROP NOT NULL;

DO $$ BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_consents_user_id_fkey' AND confdeltype = 'c'
  ) THEN
    ALTER TABLE client_consents DROP CONSTRAINT client_consents_user_id_fkey;
    ALTER TABLE client_consents ADD CONSTRAINT client_consents_user_id_fkey
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'client_consents_agent_user_id_fkey' AND confdeltype = 'c'
  ) THEN
    ALTER TABLE client_consents DROP CONSTRAINT client_consents_agent_user_id_fkey;
    ALTER TABLE client_consents ADD CONSTRAINT client_consents_agent_user_id_fkey
      FOREIGN KEY (agent_user_id) REFERENCES users(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS client_consents_user_idx
  ON client_consents (user_id, created_at DESC);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_consents_kind_check') THEN
    ALTER TABLE client_consents ADD CONSTRAINT client_consents_kind_check
      CHECK (kind IN ('agent_access', 'withdraw'));
  END IF;
END $$;

-- ---------------------------------------------------------------------------
-- Admin UI v1a (2026-07-27): the operator surface. See docs/ADMIN-UI-PLAN.md.
-- Mirrors src/lib/db.ts ensureSchema().
-- ---------------------------------------------------------------------------

-- Append-only. There is no update or delete path, ever — an audit log you can
-- edit is not an audit log.
--
-- actor_email, not a user id: the operator is identified by the env allowlist
-- rather than by a database role (§3), so the email is the only identity the
-- authorization decision was actually made on. Recording a user id here would
-- record something the check never consulted.
CREATE TABLE IF NOT EXISTS admin_audit (
  id           BIGSERIAL PRIMARY KEY,
  actor_email  TEXT NOT NULL,
  action       TEXT NOT NULL,         -- 'view_users' | 'promote_agent' | 'suspend' | ...
  target_user  UUID,                  -- nullable: some actions have no user target
  detail       JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);

-- Widen the status constraint for v1b's suspend action. Landed with v1a so the
-- whole admin wave is ONE migration to rehearse. Permitting a value is not the
-- same as being able to set it: nothing writes 'suspended' yet, and
-- canActAsViewer() already allowlists 'active', so a suspended row would be
-- refused a session the moment one can exist.
-- Conditional on the constraint not already mentioning 'suspended', so this
-- converts exactly once. An unconditional DROP + ADD would re-validate every
-- row of `users` on every ensureSchema() run.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'users_status_check'
      AND pg_get_constraintdef(oid) LIKE '%suspended%'
  ) THEN
    ALTER TABLE users DROP CONSTRAINT IF EXISTS users_status_check;
    ALTER TABLE users ADD CONSTRAINT users_status_check
      CHECK (status IN ('active', 'managed', 'invited', 'suspended'));
  END IF;
END $$;
