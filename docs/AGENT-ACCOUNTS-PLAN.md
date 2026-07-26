# Agent & Brokerage accounts — implementation plan (2026-07-26)

The B2B distribution layer: one agent seat manages many clients, each with their
own buy box, feed, and property files. Sets up the Brokerage pricing tier.

Planned at Opus tier; intended for implementation by Sonnet. Read this whole
file before writing code — several decisions below are load-bearing and are not
obvious from the source.

---

## 1. The core decision: a client IS a user

Everything in Osprey is already keyed on `users.id`:

| Table | Key |
|---|---|
| `investor_profiles` | **PK** `user_id` (one buy box per user) |
| `verdicts` | `user_id` |
| `property_reports` | `(user_id, listing_id)` |
| `share_links` | `user_id` |

The daily scan is `loadAllProfiles()` → match every profile's buy box.

**Therefore: a client is a real `users` row**, linked to their agent by a
relationship table. Their buy box is an ordinary `investor_profiles` row, so:

- the cron scan picks clients up with **zero changes to the scan loop**
- verdicts, property pages, reports, scenarios, and share links all work as-is

The rejected alternative (client buy boxes as agent-owned sub-entities) would
require rewriting `PgStore`, the scan, the property authorization gate, reports,
and sharing. Do not go that way.

It is also the business model: every client is a real account that can convert to
a paid solo seat later, and `agent_clients` records who sourced them.

### Client lifecycle

| `users.status` | Can log in | Buy box owned by | Telegram |
|---|---|---|---|
| `managed` | No (`password_hash` NULL) | Agent | none — agent gets the rollup |
| `invited` | No — invite token outstanding | Agent | none |
| `active` | Yes (claimed, set a password) | **Client** (agent keeps read) | their own chat |

---

## 2. Decisions taken (confirmed with Dylan, 2026-07-26)

1. **Scan cost — client markets ⊆ the agent's farm.** An agent declares farm
   markets; every client buy box must sit inside them. Cost stays flat per agent
   regardless of client count.
2. **Agent alerts — daily rollup digest.** One message ("3 clients had matches
   today"), never a per-verdict firehose. Per-client opt-in for live pings.
3. **Client control — see + edit after claiming; agent keeps read access** until
   the client disconnects.

---

## 3. Schema

All additive. Existing rows keep working: `role` defaults to `investor`, `status`
defaults to `active`, so today's users are unchanged.

Mirror every change in **both** `src/lib/db.ts` (`ensureSchema()`) and
`db/schema.sql` — they are kept in sync by hand. `ensureSchema()` must stay
idempotent (`IF NOT EXISTS`, and `DROP NOT NULL` is naturally idempotent).

```sql
-- users: role + lifecycle
ALTER TABLE users ADD COLUMN IF NOT EXISTS role   TEXT NOT NULL DEFAULT 'investor';
ALTER TABLE users ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'active';
ALTER TABLE users ALTER COLUMN password_hash DROP NOT NULL;  -- managed clients have none

-- agent → client roster
CREATE TABLE IF NOT EXISTS agent_clients (
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  label          TEXT,
  alerts_live    BOOLEAN NOT NULL DEFAULT false,  -- per-client live ping opt-in
  created_at     TIMESTAMPTZ DEFAULT now(),
  archived_at    TIMESTAMPTZ,
  PRIMARY KEY (agent_user_id, client_user_id)
);
CREATE INDEX IF NOT EXISTS agent_clients_client_idx ON agent_clients (client_user_id);

-- agent-level settings (farm markets now; brokerage branding later)
CREATE TABLE IF NOT EXISTS agent_settings (
  agent_user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  farm_markets  JSONB NOT NULL DEFAULT '[]'::jsonb,  -- [{city?, state}]
  updated_at    TIMESTAMPTZ DEFAULT now()
);

-- per-client invite tokens (replaces nothing; SIGNUP_INVITE_CODE stays for direct signups)
CREATE TABLE IF NOT EXISTS client_invites (
  token          TEXT PRIMARY KEY,
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,
  expires_at     TIMESTAMPTZ NOT NULL,
  accepted_at    TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS client_invites_agent_idx ON client_invites (agent_user_id);
```

`organizations` / `org_members` are **Phase 4** and deliberately not built now. A
brokerage unions over its agents' `agent_clients` rows, so the retrofit is clean.

---

## 3a. Threat model

This feature introduces something Osprey has never had: **a legitimate path for
user A to read user B's data.** Until now every user touched only their own rows,
so authorization bugs were near-impossible by construction. That property is what
we are deliberately giving up; every control below exists to replace it.

| # | Threat | Control | Verified by |
|---|---|---|---|
| T1 | **IDOR** — agent A reaches agent B's client | Branded `SubjectId`; only `resolveScope()` mints one → a missing check will not compile | Authz matrix, all call sites |
| T2 | `clientId` is attacker-supplied | Relationship re-verified in DB on **every** request; never inferred | Matrix: forged/foreign ids |
| T3 | **Auth bypass on null password** (`password_hash` becomes nullable) | Explicit guard in `authorize()` *before* `bcrypt.compare` | Test: null, empty, `"null"` |
| T4 | Existence leak via 404-vs-403 | Identical response for "not your client" and "no such user" | Matrix assertion |
| T5 | Stale JWT role | Role in JWT for **nav only**; all authz re-reads the DB | Code rule + review |
| T6 | Invite token theft/guess | `crypto.randomUUID()`, expiring, single-use, invalidated on accept | Test |
| T7 | Silent linking of an **existing** account to an agent | Requires that user's explicit in-app consent; a token click is never sufficient | Phase 2 gate |
| T8 | Agent retains access after disconnect | `archived_at` checked in `resolveScope`; share links revocable by client | Test |
| T9 | Cross-agent leakage in brokerage rollups | Deferred to Phase 4 with explicit scoping | — |
| T10 | Invite spam abuse | We send no email (see Phase 2) — surface removed entirely | — |

**Audit handle:** the trusted-context escape hatch is a single named function,
`systemSubject()`. `grep systemSubject` enumerates every authorization bypass in
the codebase. Keep it that way.

## 3b. Privacy model

**What an agent can see:** the client's buy box, financing assumptions,
cash-flow bar, verdict feed, and property files. That is financial data about a
named person — treat it accordingly.

**What an agent may never do:** change the client's email or password, delete
their account, view another agent's clients, or see login history. Least
privilege is enforced in `resolveScope`, not by UI omission.

**The consent line:**

- A **`managed`** client's data was entered *by the agent*, about their own
  client, from information the agent already held. No new disclosure beyond what
  the agent already possessed — defensible without client consent.
- The line is crossed when the client **claims** the account and begins
  contributing their own data. **Consent must be explicit and recorded at claim
  time** — a screen naming exactly what the agent can see, not buried in ToS.
- An **existing Osprey user** invited by an agent must consent in-app before any
  linkage. Clicking a token is never consent to expose an existing account.

**Rights we honor:** self-serve disconnect from agent; deletion (existing
`privacy@getosprey.ai` path, extended to agent-held data); and a defined policy
for reports and share links the agent already created.

**Documents:** Privacy Policy + ToS both need an agent-relationship section and a
new effective date. Per `osprey-compliance` this is a re-review trigger and a
**hard gate on Phase 2**, not a follow-up.

## 4. Authorization — the highest-risk area

`PgStore.loadVerdictForListing(userId, listingId)` is documented in-source as
*"the authorization gate for property features: you only model properties from
your own feed."* An agent viewing a client's property has no verdict under their
own id, so **every** call site needs scope resolution.

Do this **once**, centrally. Scattering `|| isMyClient(...)` across routes is how
IDOR holes happen.

```ts
// src/lib/scope.ts  (new)
export type Relation = "self" | "agent_of_client";

export interface Scope {
  viewerId: string;    // signed-in user
  subjectId: string;   // whose data is being read/written
  relation: Relation;
  canEdit: boolean;    // self always; agent true unless client is `active` and has disconnected
}

/** Returns null when the viewer may not act for the subject. Defaults to self
 *  when subjectId is omitted — never infer a subject from anything else. */
export async function resolveScope(
  viewerId: string,
  subjectId?: string,
): Promise<Scope | null>;
```

**Rules**

- No `subjectId` → scope is self. Never guess.
- `subjectId !== viewerId` → require a non-archived `agent_clients` row.
- **Never trust the JWT for authorization.** Role goes in the JWT for nav/UI
  only; JWTs go stale the moment a role changes. Every data access re-checks the
  DB via `resolveScope`.

**Call sites to migrate** (all currently use `session.user.id` directly):

```
src/app/api/profile/route.ts
src/app/api/onboarding/complete/route.ts
src/app/api/property/[listingId]/report/route.ts
src/app/api/property/[listingId]/report/pdf/route.ts
src/app/api/property/[listingId]/scenario/route.ts
src/app/api/property/[listingId]/share/route.ts
src/app/api/property/[listingId]/packet/route.ts
src/app/dashboard/page.tsx
src/app/settings/page.tsx
src/app/property/[listingId]/page.tsx
src/app/compare/page.tsx
```

API routes take the subject as an explicit `clientId` (query or body). Pages under
`/clients/[clientId]` pass it down.

`src/proxy.ts` matcher must add `/clients/:path*`.

Session: add `role` in the `jwt`/`session` callbacks in `src/auth.ts` and to
`src/types/next-auth.d.ts`. `authorize()` must **reject users with a NULL
`password_hash`** before reaching `bcrypt.compare` — managed/invited clients
cannot log in.

---

## 5. Scan integration

**Nothing in `runScan` changes.** Client profiles are ordinary profiles.

Two things must be handled or clients silently never scan:

1. **`onboarded: true` is mandatory.** The cron filters
   `p.onboarded !== false && p.financingProfiles.length > 0 && p.buyBox.propertyTypes.length > 0`
   (`src/app/api/cron/scan/route.ts`). An agent-created client profile that
   leaves `onboarded: false` will be skipped forever with no error.
2. **Market cap truncation is currently silent.** `deriveMarkets(profiles)` is
   sliced to `OSPREY_MAX_MARKETS` (default **5**) with only a `console.warn`, so
   over-cap markets are dropped invisibly. With the farm-market constraint total
   markets stay bounded, but this must become **visible** — surface dropped
   markets in the agent UI, and raise the default cap.

Each market is a full paginated RentCast pull (~12–20 calls) and the route has
`maxDuration = 60`; if market count grows, split the cron per market before
raising the cap further.

### Farm-market validation

New helper (validate on every client buy-box create/update):

```ts
withinFarm(buyBox: BuyBox, farm: WatchTarget[]): boolean
```

Reuse `buyBoxTargetsMarket` / `WatchTarget` from `src/osprey/agent/watcher.ts`.
Reject with a clear message naming the agent's farm markets.

---

## 6. Notifications

`investor_profiles.telegram_chat_id` is **UNIQUE**, so an agent cannot bind one
chat to many client profiles. Agent alerts are therefore a separate mechanism,
not chat-id reuse.

- **Daily agent rollup** — new `buildAgentDigest()` in
  `src/osprey/agent/digest.ts`, modelled on the existing `buildWeeklyDigest()`.
  Sent from the cron route after the scan loop. Stay silent on a zero day.
- **Per-client live ping** — only when `agent_clients.alerts_live = true`.
- **`active` clients** get their own Telegram directly (existing deep-link flow,
  unchanged).

Reuse the existing staleness guard pattern (`lastDigestAt`) so a redeploy or
extra cron run can't double-send.

---

## 7. Privacy & compliance — re-review trigger

Agent visibility into a client's financing, cash-flow bar, and deal history is
sensitive financial data. Per `osprey-compliance` (NRS 603A + FTC §5; privacy/terms
shipped Jul 21), this **requires a legal-copy pass before Phase 2 ships**:

- Clients must be told, at claim time, that their agent can see their data.
- An `active` client needs a **disconnect from agent** path.
- Buy boxes created by an agent should be labelled "set up by your agent."
- Update Privacy Policy + ToS for the agent relationship and re-date both.

Do not ship invites (Phase 2) without this.

---

## 8. UI

Reuse is high — a client detail page is essentially today's dashboard scoped to
another user id, and `OnboardingWizard.tsx` already collects a full buy box, so it
can back the "create client" flow instead of a new form.

| Route | Purpose |
|---|---|
| `/clients` | Roster: status, market, bar, last match, stale flags |
| `/clients/[clientId]` | That client's buy box + verdict feed |
| `/clients/new` | Create (managed) or invite |
| `/dashboard` | Unchanged — the agent's **own** investing |

`AppNav.tsx` currently hardcodes two links with `active: "dashboard" | "settings"`.
Widen that union and add a role-gated **Clients** link.

Share links: the preparer name shown on `/r/[token]` should be the **agent**, since
they are the one forwarding it.

---

## 9. Phasing

### Pre-flight — 3 commits, zero user-visible change

Each is behavior-preserving and independently deployable, so the guardrails are
proven against the *working* system before any new code exists.

1. **Vitest + characterization tests** — capture today's solo-investor behavior
   so a Phase 1 regression trips a test instead of a user.
2. **Extract `isScannable()`** from the cron and wire the cron to it. Pure refactor.
3. **Scan coverage observability** — record dropped markets in `scan_runs`.

| Phase | Scope | Notes |
|---|---|---|
| **0** | Schema, branded `SubjectId` + `resolveScope`, role in session, `authorize()` null-hash guard, authz matrix, feature flag | No user-visible change. Land and verify first. |
| **1** | Agent creates/manages `managed` clients; roster + client detail; farm markets | The bulk of the work |
| **2** | Invite links + claiming + **compliance copy** | The distribution flywheel |
| **3** | Agent rollup digest + per-client live pings | |
| **4** | Brokerage: `organizations`, `org_members`, cross-agent rollups, branding | |

Phases 0–1 are the real lift. Phase 2 is where the B2B flywheel actually turns.

### Phase 2 note — no email infrastructure, by design

This repo has **no email provider** (deps: Neon, bcrypt, next-auth, pdf-lib,
react, zod). Telegram is the only channel. Rather than add one, **the agent
delivers the invite link themselves** through the channel they already use with
that client. Osprey mints an expiring, single-use link; the agent sends it.

This removes CAN-SPAM/TCPA surface, deliverability, an email vendor, and the
invite-spam abuse vector — and means **we never contact a third party who has
never heard of us.** Strictly better on privacy *and* smaller to build. Do not
"upgrade" this to transactional email without revisiting the privacy review.

## 9a. Non-negotiable ship gates

1. Authz matrix passes for **every** route: self ✓, own client ✓, other agent's
   client ✗, non-agent ✗, archived relationship ✗, forged id ✗ — with **identical
   responses** for "forbidden" and "nonexistent."
2. A `managed` account **cannot authenticate** by any input.
3. Solo-investor behavior provably unchanged (characterization tests).
4. Migration rehearsed on a **Neon branch** before touching prod.
5. Phase 2 does not ship without the reviewed privacy/ToS update and a recorded
   consent step.

---

## 9b. Migration rehearsal procedure (ship gate #4)

`ensureSchema()` is all `CREATE TABLE IF NOT EXISTS` plus, since 2026-07-26, a
few `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`. Both are silent no-ops once
they have run — which is what makes a migration that *didn't* run
indistinguishable from one that did. `scripts/verify-schema.mjs` is the check.

**Status:** the ALTER path is **proven in production** (2026-07-26). The
scan-coverage columns were verified absent, `ensureSchema()` was triggered via a
read-only `/r/<invalid-token>` request, and all three columns came back present
with correct types. That was the point of landing the first ALTERs on
`scan_runs` — an append-only, no-user-data table — rather than on `users`.

**Phase 0 rehearsal (required before the `users` migration touches prod):**

1. Create a Neon branch of prod (Console → Branches → **Create branch**, from
   `main`). Copy-on-write, so it is instant and carries real data.
2. Put its connection string in `.env.local` as `NEON_BRANCH_URL` — never
   anywhere else; `.env.local` is gitignored.
3. Baseline the branch: `node scripts/verify-schema.mjs --branch`
4. Point a local dev server at the branch and exercise an `ensureSchema()`
   route so the new ALTERs run.
5. Re-run the verifier. Confirm the new columns exist **and** that the row
   counts for `users` / `investor_profiles` / `verdicts` are unchanged.
6. Confirm login still works against the branch — `password_hash DROP NOT NULL`
   is the one change that could plausibly break authentication.

Add every new column to `EXPECTED` in `verify-schema.mjs` **in the same commit**
as the migration. That is what makes it a check rather than a description.

## 10. Verification

Production has live users — every schema change must be backward compatible, and
a solo investor's experience must be **provably unchanged** through Phase 1.

- `npm run build` must stay clean; all marketing pages stay static-prerendered.
- Regression: an `investor` user's dashboard, settings, property page, scenario,
  share, and cron scan behave exactly as before.
- Authz tests: agent A must not reach agent B's client's property, report,
  scenario, share, or packet routes (try each by direct id).
- A `managed` client cannot authenticate (null `password_hash`).
- Confirm an agent-created client actually appears in `loadAllProfiles()` and
  survives the cron's `onboarded` filter.
