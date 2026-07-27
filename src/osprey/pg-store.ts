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

/** One active client on an agent's roster, joined with their profile. */
export interface AgentClientRow {
  clientUserId: string;
  label: string | null;
  /** The client's real contact address; users.email is a synthetic placeholder
   *  for managed clients. Null until the agent supplies one. */
  clientEmail: string | null;
  alertsLive: boolean;
  createdAt: string;
  name: string;
  /** 'managed' | 'invited' | 'active' — drives whether the agent may still edit. */
  status: string;
  profile: InvestorProfile | null;
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
  /** Distinct markets the onboarded profiles asked for, before the cap. */
  marketsRequested?: number;
  /** Markets this run actually pulled. */
  marketsScanned?: number;
  /** Labels of markets the cap dropped — profiles targeting only these were
   *  not scanned at all this run. Empty is the healthy state. */
  marketsDropped?: string[];
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
      INSERT INTO scan_runs (city, state, scanned, in_niche, matched, underwritten, texts, price_changes,
                             markets_requested, markets_scanned, markets_dropped)
      VALUES (${stats.city}, ${stats.state}, ${stats.scanned}, ${stats.inNiche}, ${stats.matched},
              ${stats.underwritten}, ${stats.texts}, ${stats.priceChanges},
              ${stats.marketsRequested ?? null}, ${stats.marketsScanned ?? null},
              ${stats.marketsDropped ? JSON.stringify(stats.marketsDropped) : null}::jsonb)
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

  /**
   * Distinct market labels the cap dropped in the window. Non-empty means some
   * profiles targeting only those markets went unscanned — the answer to "why
   * does this investor never get alerts?" Kept separate from
   * loadScanRunTotalsSince so the Sunday digest's query is unchanged.
   */
  async loadDroppedMarketsSince(since: Date): Promise<string[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT DISTINCT d.label
      FROM scan_runs s, LATERAL jsonb_array_elements_text(s.markets_dropped) AS d(label)
      WHERE s.ran_at >= ${since.toISOString()}
      ORDER BY d.label
    `) as { label: string }[];
    return rows.map((r) => r.label);
  }

  // --- Agent accounts ------------------------------------------------------

  /** The agent's declared farm markets (empty when never set). */
  async loadFarmMarkets(agentUserId: string): Promise<unknown[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT farm_markets FROM agent_settings WHERE agent_user_id = ${agentUserId}
    `) as { farm_markets: unknown[] }[];
    return rows[0]?.farm_markets ?? [];
  }

  async saveFarmMarkets(agentUserId: string, markets: unknown[]): Promise<void> {
    const db = requireSql();
    await db`
      INSERT INTO agent_settings (agent_user_id, farm_markets, updated_at)
      VALUES (${agentUserId}, ${JSON.stringify(markets)}::jsonb, now())
      ON CONFLICT (agent_user_id) DO UPDATE
        SET farm_markets = EXCLUDED.farm_markets, updated_at = now()
    `;
  }

  /**
   * Create a managed client: a real users row (so every per-user table keeps
   * working unchanged), its investor profile, and the roster row — atomically,
   * so a failure can never leave an orphan user with no agent.
   *
   * `email` is a SYNTHETIC placeholder. The client's real address lives in
   * agent_clients.client_email; see the schema comment for why.
   */
  async createManagedClient(params: {
    agentUserId: string;
    clientUserId: string;
    name: string;
    syntheticEmail: string;
    clientEmail: string | null;
    label: string | null;
    profile: unknown;
  }): Promise<void> {
    const db = requireSql();
    await db.transaction([
      db`
        INSERT INTO users (id, email, password_hash, name, role, status)
        VALUES (${params.clientUserId}, ${params.syntheticEmail}, NULL, ${params.name},
                'investor', 'managed')
      `,
      db`
        INSERT INTO investor_profiles (user_id, profile)
        VALUES (${params.clientUserId}, ${JSON.stringify(params.profile)}::jsonb)
      `,
      db`
        INSERT INTO agent_clients (agent_user_id, client_user_id, label, client_email)
        VALUES (${params.agentUserId}, ${params.clientUserId}, ${params.label},
                ${params.clientEmail})
      `,
    ]);
  }

  /** One row per active client on this agent's roster, newest first. */
  async listAgentClients(agentUserId: string): Promise<AgentClientRow[]> {
    const db = requireSql();
    const rows = (await db`
      SELECT ac.client_user_id, ac.label, ac.client_email, ac.alerts_live, ac.created_at,
             u.name, u.status, ip.profile
      FROM agent_clients ac
      JOIN users u ON u.id = ac.client_user_id
      LEFT JOIN investor_profiles ip ON ip.user_id = ac.client_user_id
      WHERE ac.agent_user_id = ${agentUserId} AND ac.archived_at IS NULL
      ORDER BY ac.created_at DESC
    `) as {
      client_user_id: string;
      label: string | null;
      client_email: string | null;
      alerts_live: boolean;
      created_at: string;
      name: string;
      status: string;
      profile: Record<string, unknown> | null;
    }[];
    return rows.map((r) => ({
      clientUserId: r.client_user_id,
      label: r.label,
      clientEmail: r.client_email,
      alertsLive: r.alerts_live,
      createdAt: r.created_at,
      name: r.name,
      status: r.status,
      profile: r.profile
        ? ({ ...r.profile, id: r.client_user_id } as InvestorProfile)
        : null,
    }));
  }

  /** Newest verdict per client, for the roster's "last match" column. One
   *  query for the whole book rather than N — DISTINCT ON keys off the same
   *  (user_id, created_at DESC) index the ledger already has. */
  async loadLatestVerdictPerUser(userIds: string[]): Promise<Map<string, VerdictRecord>> {
    if (userIds.length === 0) return new Map();
    const db = requireSql();
    const rows = (await db`
      SELECT DISTINCT ON (user_id) user_id, record
      FROM verdicts
      WHERE user_id = ANY(${userIds}::uuid[])
      ORDER BY user_id, created_at DESC
    `) as { user_id: string; record: VerdictRecord }[];
    return new Map(rows.map((r) => [r.user_id, r.record]));
  }

  // --- Agent accounts, phase 2: invites, claiming, consent -----------------

  /**
   * Mint an invite for a managed client.
   *
   * Three statements, in this order, atomically:
   *   1. revoke any outstanding invite for this client — an agent who clicks
   *      "invite" four times should end up with one usable link, not four
   *      independent theft targets. This MUST precede the insert or the
   *      client_invites_one_outstanding partial index rejects it.
   *   2. insert the new row (hash only; the token itself never arrives here).
   *   3. move the client to 'invited' so the roster badge tells the truth.
   *
   * Statement 3 is guarded on status = 'managed' rather than being
   * unconditional: a client who has already claimed must not be dragged back
   * to 'invited' by a stale request, which would strip their own login.
   */
  async mintInvite(params: {
    agentUserId: string;
    clientUserId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<void> {
    const db = requireSql();
    await db.transaction([
      db`
        UPDATE client_invites
           SET revoked_at = now()
         WHERE client_user_id = ${params.clientUserId}
           AND accepted_at IS NULL
           AND revoked_at IS NULL
      `,
      db`
        INSERT INTO client_invites
          (token_hash, agent_user_id, client_user_id, email, expires_at)
        VALUES
          (${params.tokenHash}, ${params.agentUserId}, ${params.clientUserId},
           ${params.email}, ${params.expiresAt.toISOString()})
      `,
      db`
        UPDATE users SET status = 'invited'
         WHERE id = ${params.clientUserId} AND status = 'managed'
      `,
    ]);
  }

  /**
   * Revoke the outstanding invite for a client and put them back to 'managed'.
   *
   * The status revert is guarded on 'invited' so revoking a spent invite can
   * never demote a client who has already claimed their account.
   */
  async revokeInvite(clientUserId: string): Promise<void> {
    const db = requireSql();
    await db.transaction([
      db`
        UPDATE client_invites
           SET revoked_at = now()
         WHERE client_user_id = ${clientUserId}
           AND accepted_at IS NULL
           AND revoked_at IS NULL
      `,
      db`
        UPDATE users SET status = 'managed'
         WHERE id = ${clientUserId} AND status = 'invited'
      `,
    ]);
  }

  /**
   * What the public claim page needs to render, or null.
   *
   * Read-only and deliberately thin: it returns the two display names and
   * nothing else about the client. The caller renders ONE identical dead-link
   * state for every failure — expired, revoked, accepted, malformed, never
   * existed — so this must not hand back anything that could distinguish them
   * (docs/AGENT-ACCOUNTS-PLAN.md §3a T4).
   */
  async loadInviteForClaim(tokenHash: string): Promise<{
    agentUserId: string;
    clientUserId: string;
    agentName: string;
    clientName: string;
    email: string;
  } | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT i.agent_user_id, i.client_user_id, i.email,
             a.name AS agent_name, c.name AS client_name
      FROM client_invites i
      JOIN users a ON a.id = i.agent_user_id
      JOIN users c ON c.id = i.client_user_id
      WHERE i.token_hash  = ${tokenHash}
        AND i.accepted_at IS NULL
        AND i.revoked_at  IS NULL
        AND i.expires_at  > now()
        AND c.status      = 'invited'
      LIMIT 1
    `) as {
      agent_user_id: string;
      client_user_id: string;
      email: string;
      agent_name: string;
      client_name: string;
    }[];
    const row = rows[0];
    if (!row) return null;
    return {
      agentUserId: row.agent_user_id,
      clientUserId: row.client_user_id,
      agentName: row.agent_name,
      clientName: row.client_name,
      email: row.email,
    };
  }

  /**
   * Consume an invite and claim the account. THE security-critical write.
   *
   * One statement, not a transaction of several, because the single-use
   * guarantee has to be a property of the database rather than of this
   * process. The `claimed` CTE's WHERE clause IS the validity check, so two
   * simultaneous clicks on the same link contend on the same row and exactly
   * one wins — no application-level locking, no read-then-write window.
   * Everything downstream is chained off `claimed`, so when it matches nothing
   * the rest of the statement touches nothing.
   *
   * Being one statement also means a UNIQUE violation on users.email (the
   * claimer typed an address that already has an Osprey account) rolls the
   * whole thing back and leaves the invite OUTSTANDING — so they can retry
   * with a different address rather than being locked out by a link that is
   * now spent. The caller still reports that failure generically; see the
   * route for why naming it would be an enumeration oracle.
   *
   * Returns null when the invite was not usable. The caller must not
   * distinguish that from any other failure in what it renders.
   */
  async claimInvite(params: {
    tokenHash: string;
    email: string;
    passwordHash: string;
    policyVersion: string;
    disclosure: string;
  }): Promise<{ clientUserId: string; agentUserId: string } | null> {
    const db = requireSql();
    const rows = (await db`
      WITH claimed AS (
        UPDATE client_invites
           SET accepted_at = now()
         WHERE token_hash  = ${params.tokenHash}
           AND accepted_at IS NULL
           AND revoked_at  IS NULL
           AND expires_at  > now()
        RETURNING agent_user_id, client_user_id
      ),
      promoted AS (
        UPDATE users u
           SET email         = ${params.email},
               password_hash = ${params.passwordHash},
               status        = 'active'
          FROM claimed c
         WHERE u.id = c.client_user_id
           AND u.status = 'invited'
        RETURNING u.id
      ),
      labelled AS (
        UPDATE investor_profiles ip
           SET profile = jsonb_set(ip.profile, '{setUpByAgent}', 'true'::jsonb, true)
          FROM promoted p
         WHERE ip.user_id = p.id
        RETURNING ip.user_id
      ),
      consented AS (
        INSERT INTO client_consents
          (user_id, agent_user_id, kind, policy_version, disclosure)
        SELECT c.client_user_id, c.agent_user_id, 'agent_access',
               ${params.policyVersion}, ${params.disclosure}
        FROM claimed c
        JOIN promoted p ON p.id = c.client_user_id
        RETURNING id
      )
      SELECT c.client_user_id, c.agent_user_id,
             (SELECT count(*) FROM promoted)  AS promoted_count,
             (SELECT count(*) FROM consented) AS consented_count,
             (SELECT count(*) FROM labelled)  AS labelled_count
      FROM claimed c
    `) as {
      client_user_id: string;
      agent_user_id: string;
      promoted_count: number;
      consented_count: number;
      labelled_count: number;
    }[];

    const row = rows[0];
    if (!row) return null;

    // The invite was usable but the user row was not 'invited', or consent did
    // not record. Both are invariant violations rather than ordinary failures —
    // mintInvite() sets 'invited' in the same transaction that creates the
    // invite, so they should be unreachable. Refuse loudly in the log and
    // generically to the caller rather than reporting a claim that did not
    // fully happen.
    if (Number(row.promoted_count) === 0 || Number(row.consented_count) === 0) {
      console.error(
        "claimInvite: invite consumed but claim incomplete",
        {
          clientUserId: row.client_user_id,
          promoted: Number(row.promoted_count),
          consented: Number(row.consented_count),
          labelled: Number(row.labelled_count),
        },
      );
      return null;
    }

    return { clientUserId: row.client_user_id, agentUserId: row.agent_user_id };
  }

  /** The agent currently holding an active roster row for this user, if any.
   *  Drives the disconnect control in Settings. */
  async loadActiveAgentForClient(clientUserId: string): Promise<{
    agentUserId: string;
    agentName: string;
  } | null> {
    const db = requireSql();
    const rows = (await db`
      SELECT ac.agent_user_id, u.name AS agent_name
      FROM agent_clients ac
      JOIN users u ON u.id = ac.agent_user_id
      WHERE ac.client_user_id = ${clientUserId}
        AND ac.archived_at IS NULL
      LIMIT 1
    `) as { agent_user_id: string; agent_name: string }[];
    const row = rows[0];
    return row ? { agentUserId: row.agent_user_id, agentName: row.agent_name } : null;
  }

  /**
   * End the agent relationship, and record why.
   *
   * `archived_at` is the only thing resolveScope() consults, so setting it
   * revokes the agent on their very next request — threat T8, handled by code
   * that already existed before Phase 2. Any outstanding invite is revoked in
   * the same transaction: a live token that outlives the relationship it was
   * minted under would silently re-create it on click.
   *
   * `reason` distinguishes a client who chose to leave from one moved out
   * automatically by the farm-market rule. Both are withdrawals of the agent's
   * access and both belong in the append-only consent ledger.
   */
  async disconnectAgent(params: {
    clientUserId: string;
    agentUserId: string;
    policyVersion: string;
    reason: string;
  }): Promise<void> {
    const db = requireSql();
    await db.transaction([
      db`
        UPDATE agent_clients
           SET archived_at = now()
         WHERE client_user_id = ${params.clientUserId}
           AND agent_user_id  = ${params.agentUserId}
           AND archived_at IS NULL
      `,
      db`
        UPDATE client_invites
           SET revoked_at = now()
         WHERE client_user_id = ${params.clientUserId}
           AND accepted_at IS NULL
           AND revoked_at IS NULL
      `,
      db`
        INSERT INTO client_consents
          (user_id, agent_user_id, kind, policy_version, disclosure)
        VALUES
          (${params.clientUserId}, ${params.agentUserId}, 'withdraw',
           ${params.policyVersion}, ${params.reason})
      `,
    ]);
  }

  /**
   * Clients who left this agent's roster recently, and why.
   *
   * Exists because listAgentClients() filters on archived_at IS NULL, so a
   * disconnected client simply vanishes from the roster. That is fine when the
   * agent did the archiving themselves and knows why. It is not fine for the
   * two cases where they did not: the client disconnected from Settings, or
   * the farm rule disconnected them automatically after a buy-box move. An
   * agent losing a client silently, with no way to find out what happened, is
   * a support ticket that cannot be answered.
   *
   * The reason comes from the append-only consent ledger rather than from a
   * column on agent_clients, so it says what was actually recorded at the time
   * rather than a status someone could later overwrite. The LATERAL takes the
   * newest withdrawal per client, since the ledger accumulates.
   *
   * The window is computed in SQL from now() rather than passed in as a Date.
   * Every other timestamp in this table comes from the database clock, so a
   * cutoff computed from the web server's clock could disagree with the
   * archived_at values it is being compared against — and computing it in a
   * server component is a render-purity violation besides.
   */
  async listRecentlyDisconnectedClients(
    agentUserId: string,
    withinDays: number,
  ): Promise<
    { clientUserId: string; name: string; archivedAt: string; reason: string | null }[]
  > {
    const db = requireSql();
    const rows = (await db`
      SELECT ac.client_user_id, u.name, ac.archived_at, w.disclosure AS reason
      FROM agent_clients ac
      JOIN users u ON u.id = ac.client_user_id
      LEFT JOIN LATERAL (
        SELECT disclosure
        FROM client_consents
        WHERE user_id = ac.client_user_id
          AND agent_user_id = ac.agent_user_id
          AND kind = 'withdraw'
        ORDER BY created_at DESC
        LIMIT 1
      ) w ON true
      WHERE ac.agent_user_id = ${agentUserId}
        AND ac.archived_at IS NOT NULL
        AND ac.archived_at >= now() - make_interval(days => ${withinDays})
      ORDER BY ac.archived_at DESC
    `) as {
      client_user_id: string;
      name: string;
      archived_at: string;
      reason: string | null;
    }[];
    return rows.map((r) => ({
      clientUserId: r.client_user_id,
      name: r.name,
      archivedAt: r.archived_at,
      reason: r.reason,
    }));
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

  /** True when ANY user has a verdict on this listing — gates whether a
   *  snapshot backfill is worth an AVM call (someone's property page needs it). */
  async hasVerdictsForListing(listingId: string): Promise<boolean> {
    const db = requireSql();
    const rows = (await db`
      SELECT 1 FROM verdicts WHERE listing_id = ${listingId} LIMIT 1
    `) as unknown[];
    return rows.length > 0;
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
