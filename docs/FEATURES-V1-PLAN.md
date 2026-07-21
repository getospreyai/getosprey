# Property Files v1 — feature rollout spec (2026-07-19)

Why: the core loop (scan → underwrite → Telegram verdict) is replicable by hand with Claude + Zillow links. Differentiation = per-property depth that's hard to fake manually, and client-facing polish a realtor can forward. Market research (DealCheck/Mashvisor/Zilculator/Rentometer) says the paid features are: branded shareable reports, side-by-side comparison, saved property files, long-horizon lender-ready projections.

**Cost discipline (first-class requirement):** nothing expensive runs during the cron scan. The scan only *persists raw data it already holds*. Engine math (pure TS) runs on demand for free. The only LLM spend is an explicit user-requested research report, cached in Postgres forever after.

## Features

1. **Listing snapshots** (foundation) — persist the RentCast listing + rent estimate at scan time so every later feature can re-run the engine.
2. **Property deep-dive page** `/property/[listingId]` — full underwriting UI + **Scenario Studio** (model any FinancingProfile / assumption overrides without touching the saved profile) + 30-yr projection + rent-confidence display.
3. **Compare** `/compare?ids=a,b,c` — 2–4 properties head-to-head at the user's default financing.
4. **AI research report** — on-demand, cached; web + Telegram (PDF via sendDocument).
5. **Shareable public link** `/r/[token]` — read-only property report a realtor forwards to a client. The brokerage-ICP demo feature.
6. **Dashboard integration** — verdict cards link to property pages; multi-select → Compare.

## Codebase facts (already verified — don't re-derive)

- Repo: `getosprey/` (Next.js 16 App Router + Tailwind v4 + Neon). **Read `getosprey/AGENTS.md` first: this Next.js version has breaking changes; consult `node_modules/next/dist/docs/` before writing Next code.**
- Engine (`src/osprey/engine/`): `underwrite({property, income, financing, assumptions?})` → `Underwriting`; `project()`/`irr()` → `Projection`; accepts arbitrary `FinancingProfile` (conventional/fha/dscr/cash). All pure functions — scenario modeling and compare are **new routes/UI, not new math**.
- `RentBasis` already carries `rangeLow/rangeHigh/source/note` → rent-confidence UI is free.
- Scan: `src/osprey/agent/loop.ts` `runScan(batch, profiles, seen, deps)`; has `listing` + `rentEstimate` in hand right where `deliver` is called. `VerdictRecord` currently stores only summary + prose `analysis`.
- Callers of `runScan`: `src/app/api/cron/scan/route.ts` and `src/app/api/onboarding/complete/route.ts` (personal first scan).
- Store: `src/osprey/pg-store.ts` (`PgStore`), schema in BOTH `src/lib/db.ts` `ensureSchema()` AND `db/schema.sql` — keep in sync. Lazy `sql` client pattern (null until DATABASE_URL; importing never throws).
- **Never clobber `telegram_chat_id`**: web write paths must use `saveProfileSettings`, not `saveProfile`.
- Telegram: `src/osprey/agent/telegram.ts` (`TelegramClient` JSON-only `call()`; `VERDICT_KEYBOARD` A/P/S buttons; `handleUpdate` routes updates, `tg_anchors` maps chat+message→listing). Webhook: `src/app/api/telegram/route.ts`. Intents: `messenger/intents.ts` (zod discriminated union), fast-path `messenger/fastpath.ts`, executor `messenger/actions.ts`, pipeline `messenger/respond.ts`.
- LLM: `@anthropic-ai/sdk` already a dep; `ANTHROPIC_API_KEY` optional (NOT yet set in prod — reports will require it).
- UI style: dark `bg-[#0a0718]`, glassy cards `rounded-2xl border border-white/10 bg-white/[0.05] backdrop-blur-md`, violet accents. Copy `src/app/dashboard/page.tsx` idiom. `AppNav`, `Backdrop`, `src/lib/format.ts` helpers exist.

## DB additions (add to ensureSchema() AND db/schema.sql; CREATE TABLE IF NOT EXISTS)

```sql
CREATE TABLE IF NOT EXISTS listing_snapshots (
  listing_id  TEXT PRIMARY KEY,
  listing     JSONB NOT NULL,        -- RentCastListing verbatim
  rent        JSONB,                 -- RentCastRentEstimate verbatim (incl. comparables)
  captured_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS property_reports (
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'generating',  -- 'generating' | 'ready' | 'failed'
  report      JSONB,                 -- structured report (see schema below); null while generating
  model       TEXT,
  created_at  TIMESTAMPTZ DEFAULT now(),
  updated_at  TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (user_id, listing_id)
);

CREATE TABLE IF NOT EXISTS share_links (
  token       TEXT PRIMARY KEY,      -- crypto.randomUUID() without dashes, or 24+ url-safe random chars
  user_id     UUID REFERENCES users(id) ON DELETE CASCADE,
  listing_id  TEXT NOT NULL,
  revoked     BOOLEAN NOT NULL DEFAULT false,
  created_at  TIMESTAMPTZ DEFAULT now()
);
```

## Phase 1 — data layer + APIs (Opus agent)

1. Schema above in both places. New `PgStore` methods: `saveSnapshot(listingId, listing, rent)`, `loadSnapshot(listingId)`, `loadVerdictForListing(userId, listingId)` (newest verdict row for that pair), `getReport/upsertReportGenerating/saveReportReady/markReportFailed`, `createShareLink/loadShareLink/revokeShareLink/listShareLinks(userId)`, `countReportsSince(userId, since)`.
2. `ScanDeps` gains optional `persistSnapshot?: (listing: RentCastListing, rent: RentCastRentEstimate) => Promise<void>`; `runScan` calls it (await, wrapped in try/catch so a snapshot failure never kills a scan) right after a successful rent fetch for a matched listing. Wire it in both scan callers → `store.saveSnapshot`.
3. **Scenario route** `POST /api/property/[listingId]/scenario` (auth required):
   - zod body: `{ financing: FinancingProfile, assumptions?: Partial<Assumptions>, rentOverride?: number, projectionYears?: number }` (validate `financing` with a zod schema mirroring engine types; reuse/extend `src/lib/profile-schema.ts` if it already models FinancingProfile).
   - Authorization: user must have a verdict for this listing (`loadVerdictForListing`) — you only model properties from your own feed.
   - Load snapshot → `toPropertyInput`/`toIncomeInput` (apply `rentOverride` by replacing `monthlyRent`, source `'manual'`) → merge assumptions over the user's profile assumptions → `underwrite()` + `project()` → return `{ underwriting, projection }`. 404 with a clear code (`no_snapshot`) when the listing predates snapshots.
4. **Report service** `src/osprey/reports/generate.ts` + `POST /api/property/[listingId]/report`:
   - Load the `claude-api` skill before writing the Anthropic call. Model: `claude-sonnet-5`. Use the server-side `web_search` tool (cap `max_uses: 3`) so neighborhood/trend claims are grounded, not hallucinated.
   - Prompt (premade, engineered once): inputs = listing snapshot (address/beds/baths/sqft/year/DOM/price), rent estimate incl. comparables array, our underwriting output at the user's default financing (cash flow, cap rate, CoC, DSCR, projection summary), buy-box context. Ask for structured JSON (use a zod schema + tool-forced output or response prefill per the skill's guidance): `{ headline, summary, dealNumbers, rentComps, neighborhood, market Trends, risks, negotiationAngles, bottomLine }` — each section `{ title, body (markdown), bullets? }`.
   - Flow: rate-limit (10 reports/user/24h via `countReportsSince`) → `upsertReportGenerating` (if an existing row is 'ready' and `force` not set, return cached; if 'generating' < 5 min old, return 409 in_progress — this dedups Telegram webhook retries) → call Claude → `saveReportReady` → return report. On error `markReportFailed`.
5. **PDF renderer** `src/osprey/reports/pdf.ts`: `pdf-lib` (add dep), deterministic render of the structured report — Osprey wordmark, violet accent, address header, sections, "Prepared by {name} with Osprey · getosprey.ai" footer. Export `reportToPdf(report, meta): Promise<Uint8Array>`. Also `GET /api/property/[listingId]/report/pdf` returning it as a download (auth'd).
6. **Share routes**: `POST /api/property/[listingId]/share` → create (or return existing non-revoked) token, return `{ url: "/r/<token>" }`; `DELETE` → revoke. Auth'd, verdict-ownership check.
7. Verify: `npm run build` and `npm run lint` clean in `getosprey/`.

## Phase 2 — web UI (Sonnet agent)

1. `/property/[listingId]` server component (auth): loads verdict + snapshot + report + share link. Sections:
   - Header: address, price, type/beds/sqft/year, verdict badge (cash flow vs user bar), DOM.
   - Underwriting: monthly cash-flow statement table, metrics grid (cap rate, CoC, DSCR, GRM, 1% rule, break-even), loan breakdown, qualification checks. Data = server-side `underwrite()` at user's default profile (best-cash-flow profile like the scan does).
   - Rent confidence: monthly rent + AVM range bar + source note.
   - Projection: 30-yr table (key years 1/2/3/5/10/20/30) + equity/cash-flow summary, IRR at exit.
   - **Scenario Studio** (client island): financing-kind tabs (FHA/Conventional/DSCR/Cash) with rate/down/term inputs + rent override + key assumption sliders (vacancy, maintenance, management) → POST scenario route → results panel; "pin" up to 3 scenarios side-by-side in a mini-table. No persistence needed in v1.
   - **AI report section**: none yet → "Generate research report" button (POST report route, poll or await; show generating state); ready → render sections + "Download PDF" + regenerate. Failed → retry.
   - **Share card**: create/copy/revoke public link.
   - Graceful degrade when no snapshot (old verdicts): show VerdictRecord `analysis` text + note that live modeling starts with new verdicts.
2. `/compare` server component: `?ids=a,b,c` (2–4) → column per property (address, price, rent, cash flow, cap, CoC, DSCR, GRM, 1%, cash-to-close, 10-yr IRR), best value per row highlighted. Engine runs server-side directly (no API hop).
3. Dashboard: each verdict card links to its property page; client-side multi-select checkboxes + floating "Compare (n)" button → `/compare?ids=`.
4. `/r/[token]` public page (no auth): resolve share link (404 if revoked), render read-only property report — same underwriting/projection sections (computed at owner's default financing) + AI report if ready + "Prepared by {owner name} · Powered by Osprey" header, subtle getosprey.ai CTA footer. No scenario studio, no actions.
5. Match existing visual idiom exactly. Verify build + lint.

## Phase 3 — Telegram (Opus agent)

1. `TelegramClient.sendDocument(chatId, filename, bytes, caption?)` via multipart `FormData` (the JSON `call()` won't do; use fetch with FormData + Blob).
2. Intent: add `{ kind: "research_report", deal: dealRef }` to `IntentSchema`; fast-path `R`; add `📄 Report` button (callback_data `R`) to `VERDICT_KEYBOARD`.
3. `executeIntent` returns a new optional `reportRequest: VerdictRecord` result field (deterministic, no side effects there). `respond()` surfaces it in `RespondResult`.
4. Webhook route (`/api/telegram`): when `reportRequest` present → immediately send "🔍 Building your research report — about a minute ⏳" → call the Phase-1 report service (cached hit returns instantly) → `reportToPdf` → `sendDocument` with a one-line caption (address + cash flow + link to `/property/[id]`). On rate-limit/409/failure send a friendly text. Set `export const maxDuration = 300` on the route. The report service's 'generating' dedup handles Telegram webhook retries.
5. HELP text: mention the new R / "report" command. Keep local-dev parity: mirror intent changes in vendored code only (sibling CLI repos are dev harness, do NOT touch them).
6. Verify build + lint.

## Out of scope v1 (noted for v2)

Portfolio rollups across a realtor's client list · realtor branding/white-label on shared pages · XLS export · saved-scenario persistence · payments.

## Post-merge checklist (Dylan)

- Set `OPENROUTER_API_KEY` in Vercel.
- Leave `RENTCAST_ENABLED` unset until the RentCast plan is upgraded.
- Redeploy; webhook unchanged.
