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

  // One round trip. Each tagged-template call is its own HTTP request on
  // Neon's driver, so issuing these sequentially cost ~20 round trips on
  // every cold start — latency paid directly on the login path, since
  // authorize() awaits ensureSchema() before bcrypt runs. Batching also
  // makes the migration atomic: a failure rolls the whole set back rather
  // than leaving the schema half-applied.
  await sql.transaction([
    // gen_random_uuid() is built into Postgres core since v13 (no pgcrypto needed).
    sql`
      CREATE TABLE IF NOT EXISTS users (
        id            UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        email         TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        name          TEXT NOT NULL,
        created_at    TIMESTAMPTZ DEFAULT now()
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS investor_profiles (
        user_id           UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        profile            JSONB NOT NULL,
        telegram_chat_id  BIGINT UNIQUE,
        updated_at        TIMESTAMPTZ DEFAULT now()
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS verdicts (
        id          BIGSERIAL PRIMARY KEY,
        user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
        listing_id  TEXT NOT NULL,
        record      JSONB NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `,

    sql`
      CREATE INDEX IF NOT EXISTS verdicts_user_created_idx
        ON verdicts (user_id, created_at DESC)
    `,

    sql`
      CREATE TABLE IF NOT EXISTS seen_listings (
        listing_id  TEXT PRIMARY KEY,
        seen_at     TIMESTAMPTZ DEFAULT now()
      )
    `,

    sql`
      CREATE TABLE IF NOT EXISTS tg_anchors (
        chat_id     BIGINT NOT NULL,
        message_id  BIGINT NOT NULL,
        listing_id  TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT now(),
        PRIMARY KEY (chat_id, message_id)
      )
    `,

    // Raw RentCast payloads persisted at scan time so every property feature can
    // re-run the engine on demand without re-hitting the paid AVM/listing APIs.
    sql`
      CREATE TABLE IF NOT EXISTS listing_snapshots (
        listing_id  TEXT PRIMARY KEY,
        listing     JSONB NOT NULL,
        rent        JSONB,
        captured_at TIMESTAMPTZ DEFAULT now()
      )
    `,

    // On-demand LLM research reports, cached forever after first generation.
    sql`
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
    `,

    // Read-only public share tokens a realtor forwards to a client.
    sql`
      CREATE TABLE IF NOT EXISTS share_links (
        token       TEXT PRIMARY KEY,
        user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
        listing_id  TEXT NOT NULL,
        revoked     BOOLEAN NOT NULL DEFAULT false,
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `,

    // Price-change timeline, written by the (dormant, RENTCAST_ENABLED-gated)
    // price-cut re-underwrite path. `kind` is 'price_change' today; leaves
    // room for other listing_snapshots-derived events later.
    sql`
      CREATE TABLE IF NOT EXISTS listing_events (
        id          BIGSERIAL PRIMARY KEY,
        listing_id  TEXT NOT NULL,
        kind        TEXT NOT NULL,
        old_price   NUMERIC,
        new_price   NUMERIC,
        created_at  TIMESTAMPTZ DEFAULT now()
      )
    `,

    sql`
      CREATE INDEX IF NOT EXISTS listing_events_listing_idx
        ON listing_events (listing_id)
    `,

    // One row per daily cron scan — the Sunday digest's "last 7 days" input.
    // Written only on the RENTCAST_ENABLED path; the disabled path writes
    // nothing here, same as everywhere else RentCast-gated.
    sql`
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
    `,

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
    sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_requested INT`,
    sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_scanned INT`,
    sql`ALTER TABLE scan_runs ADD COLUMN IF NOT EXISTS markets_dropped JSONB`,

    // -------------------------------------------------------------------------
    // Agent accounts, phase 0 (2026-07-26). See docs/AGENT-ACCOUNTS-PLAN.md.
    //
    // Existing rows are unaffected: role defaults to 'investor' and status to
    // 'active', which is exactly what every current user is.
    // -------------------------------------------------------------------------

    // 'investor' | 'agent' | 'brokerage_admin'
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'investor'`,
    // 'active' | 'managed' | 'invited'. A managed/invited client is a real user
    // row the agent manages; it has no password and MUST NOT be able to log in
    // (enforced in src/auth.ts authorize(), not by this column).
    sql`ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active'`,
    // Managed clients have no password. Postgres treats dropping a NOT NULL that
    // isn't there as a no-op, so this stays idempotent.
    sql`ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL`,

    // The agent -> client roster. resolveScope() reads this on every
    // cross-user access, so an archived row immediately revokes the agent.
    sql`
      CREATE TABLE IF NOT EXISTS agent_clients (
        agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        label          TEXT,
        alerts_live    BOOLEAN NOT NULL DEFAULT false,
        created_at     TIMESTAMPTZ DEFAULT now(),
        archived_at    TIMESTAMPTZ,
        PRIMARY KEY (agent_user_id, client_user_id)
      )
    `,

    sql`
      CREATE INDEX IF NOT EXISTS agent_clients_client_idx
        ON agent_clients (client_user_id)
    `,

    // A client belongs to at most ONE agent at a time. Without this, nothing
    // stops two agents each holding an active roster row for the same person,
    // both reading their financial data — while the privacy copy promises the
    // client that "your agent" (singular) has access. Archived rows are excluded
    // so a client can be handed from one agent to another.
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS agent_clients_one_active_agent
        ON agent_clients (client_user_id) WHERE archived_at IS NULL
    `,

    // The agent's declared farm markets. Client buy boxes must fall inside
    // these (see withinFarm), which is what keeps daily scan cost flat per
    // agent no matter how many clients they add — each distinct market is its
    // own full paginated RentCast pull.
    sql`
      CREATE TABLE IF NOT EXISTS agent_settings (
        agent_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        farm_markets  JSONB NOT NULL DEFAULT '[]'::jsonb,
        updated_at    TIMESTAMPTZ DEFAULT now()
      )
    `,

    // The client's real contact address, kept OFF users.email deliberately.
    // A managed client's users.email is a synthetic placeholder, so adding a
    // client can never collide with an existing account — which would both
    // fail confusingly and turn client creation into an email-enumeration
    // oracle. Phase 2's invite reads this; claiming moves it onto users.email
    // under the consent flow, where a collision is handled explicitly.
    sql`ALTER TABLE agent_clients ADD COLUMN IF NOT EXISTS client_email TEXT`,

    // Constrain the enum-ish columns. canActAsViewer() allowlists 'active', so a
    // typo would lock an account out rather than open it up — but a bad value is
    // still a silent, hard-to-diagnose state, and role has no code-level guard at
    // all. ADD CONSTRAINT has no IF NOT EXISTS, hence the catalog check.
    sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_status_check') THEN
          ALTER TABLE users ADD CONSTRAINT users_status_check
            CHECK (status IN ('active', 'managed', 'invited'));
        END IF;
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'users_role_check') THEN
          ALTER TABLE users ADD CONSTRAINT users_role_check
            CHECK (role IN ('investor', 'agent', 'brokerage_admin'));
        END IF;
      END $$
    `,

    // -------------------------------------------------------------------------
    // Agent accounts, phase 2 (2026-07-27). Invite links + claiming.
    // See docs/PHASE-2-INVITES-PLAN.md.
    // -------------------------------------------------------------------------

    // Per-client invite tokens. The agent mints one and delivers it themselves
    // through whatever channel they already use with that client — Osprey sends
    // no email (docs/AGENT-ACCOUNTS-PLAN.md §9), which is what keeps CAN-SPAM,
    // deliverability, and the invite-spam vector out of the product entirely.
    //
    // token_hash, NOT the token. A raw invite token is a bearer credential for
    // becoming someone else's account: anything that can read this table — a
    // backup, a slow-query log, a Neon branch handed to a contractor — would
    // otherwise be account takeover for every outstanding invite. Storing
    // sha256 makes the table useless to a reader.
    //
    // Plain sha256 with no salt or KDF is correct HERE specifically because the
    // token is 256 bits of CSPRNG output: there is no dictionary to attack, so
    // the slow-hash argument that applies to passwords does not apply. Do not
    // "upgrade" this to bcrypt — its 72-byte truncation and cost factor buy
    // nothing against a random 256-bit secret.
    sql`
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
      )
    `,

    sql`
      CREATE INDEX IF NOT EXISTS client_invites_agent_idx
        ON client_invites (agent_user_id)
    `,
    sql`
      CREATE INDEX IF NOT EXISTS client_invites_client_idx
        ON client_invites (client_user_id)
    `,

    // At most one outstanding invite per client. Every live token is an
    // independent theft target, so an agent who clicks "invite" four times
    // should end up with one usable link, not four.
    sql`
      CREATE UNIQUE INDEX IF NOT EXISTS client_invites_one_outstanding
        ON client_invites (client_user_id)
        WHERE accepted_at IS NULL AND revoked_at IS NULL
    `,

    // The recorded consent required by ship gate #5.
    //
    // APPEND-ONLY. A withdrawal is a new row (kind 'withdraw'), never an UPDATE
    // or DELETE, because the question this table answers is "what did they
    // agree to, and when" — which a mutable row cannot answer after the fact.
    //
    // `disclosure` stores the text shown VERBATIM rather than a reference to
    // it. A pointer to copy that lives in a .tsx file is worthless a year later
    // when the copy has changed; the record has to be self-contained to be
    // evidence of anything. A few hundred bytes per claim.
    //
    // Deliberately NOT stored: IP address and user-agent. They are tempting as
    // "proof", but they are additional personal data collected at the exact
    // moment we are promising a minimal-collection posture, and Privacy Policy
    // §2 does not disclose collecting them for this purpose. If legal review
    // asks for them, they get added here and to the policy together.
    sql`
      CREATE TABLE IF NOT EXISTS client_consents (
        id             BIGSERIAL PRIMARY KEY,
        user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        kind           TEXT NOT NULL,
        policy_version TEXT NOT NULL,
        disclosure     TEXT NOT NULL,
        created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
      )
    `,

    sql`
      CREATE INDEX IF NOT EXISTS client_consents_user_idx
        ON client_consents (user_id, created_at DESC)
    `,

    sql`
      DO $$ BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'client_consents_kind_check') THEN
          ALTER TABLE client_consents ADD CONSTRAINT client_consents_kind_check
            CHECK (kind IN ('agent_access', 'withdraw'));
        END IF;
      END $$
    `,

  ]);

  schemaReady = true;
}
