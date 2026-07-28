# Phase 2 migration rehearsal — runbook

Ship gate #4 (`docs/AGENT-ACCOUNTS-PLAN.md` §9a): no migration reaches
production until it has run against a Neon branch carrying real data.

## EXECUTED 2026-07-27 — PASSED

Ran end to end against the `ep-sweet-mud-a64la88a` branch (2 users, 2 profiles,
44 verdicts). Results:

| Step | Result |
|---|---|
| 3. Baseline | 9 expected columns absent, `client_invites` / `client_consents` / `admin_audit` all "table not present" — a clean pre-migration branch |
| 4. `rehearse-migration.mts` | `ensureSchema() completed in 409ms` |
| 5. Verify | **All** expected columns PASS, both new nullable columns PASS, both delete rules PASS (`SET NULL`), `client_invites.token` still absent, **row counts identical to baseline** (2 / 2 / 44) |
| 5b. Constraint | `users_status_check` now reads `active, managed, invited, suspended` — the v1a widening applied cleanly |
| 6. App | Signed in as a solo investor, dashboard rendered its verdict feed, `/settings` loaded with **no** agent card (flag unset) |
| 6b. Admin v1a | `/admin` 404s for a signed-in non-admin; renders the metadata list for an allowlisted one; two `admin_audit` `view_users` rows written |

Nothing was run against production. `scripts/dev-branch.mjs` (added the same
day) is what makes step 6 executable on Windows and refuses to start if
`NEON_BRANCH_URL` and `DATABASE_URL` resolve to the same database.

**Teardown (step 7) is still outstanding** — the branch is deliberately kept
alive to seed test accounts and to develop admin v1b against. Delete it when
that work lands; a forgotten branch is a copy-on-write copy of real user data
sitting somewhere nobody is thinking about.

Follows the Phase 0 procedure in `AGENT-ACCOUNTS-PLAN.md` §9b, which is already
proven: the ALTER path was verified in production on 2026-07-26.

---

## What this wave actually does

Phase 2 adds two tables:

| Object | Type |
|---|---|
| `client_invites` | `CREATE TABLE IF NOT EXISTS` |
| `client_invites_agent_idx` / `client_invites_client_idx` | `CREATE INDEX IF NOT EXISTS` |
| `client_invites_one_outstanding` | `CREATE UNIQUE INDEX IF NOT EXISTS` (partial) |
| `client_consents` | `CREATE TABLE IF NOT EXISTS` |
| `client_consents_user_idx` | `CREATE INDEX IF NOT EXISTS` |
| `client_consents_kind_check` | `ADD CONSTRAINT`, guarded by a `pg_constraint` lookup |

Two later waves ride along with it and are **not** as inert, so the original
"no ALTER on an existing table" claim below no longer holds unqualified:

| Object | Type | Added by |
|---|---|---|
| `client_consents.user_id` / `.agent_user_id` | `DROP NOT NULL` + FK recreated `ON DELETE SET NULL` | §A6 fix (`ea7affd`) |
| `admin_audit` + `admin_audit_created_idx` | `CREATE TABLE` / `CREATE INDEX` | Admin v1a |
| `users_status_check` | `DROP CONSTRAINT` + `ADD CONSTRAINT` including `'suspended'` | Admin v1a |

The `users_status_check` recreation is the only one that touches a table holding
user data. It re-validates every row of `users`, and every existing status is
already in the new set, so it is expected to be a no-op that succeeds — which is
what the rehearsal above confirmed. The `client_consents` ALTERs are guarded on
`confdeltype = 'c'`, so they convert once and then stop matching.

It is worth being clear about why we rehearse anyway. The risk here is not that
the migration corrupts data — it cannot reach any. It is that `ensureSchema()`
is idempotent by construction, so **a migration that silently did not run is
indistinguishable from one that did**, and the first symptom in production would
be a 500 on the first invite. `scripts/verify-schema.mjs` is the check that
turns that into an answer.

One genuine risk does exist: `ensureSchema()` runs its statements as a single
`sql.transaction([...])`. A failure in the new statements fails the whole batch,
which means **every** schema statement rolls back — including ones existing
routes depend on having run. They have all run already in production, so this is
a no-op in practice, but it is the reason step 6 checks that the app still works
rather than only that the columns exist.

---

## Prerequisites

- On branch `phase2-invites`, working tree clean.
- `.env.local` with a working `DATABASE_URL` (production, read only — used
  solely for the safety comparison in step 4).
- Node with `--experimental-strip-types` (the rehearsal script is `.mts`).

---

## Steps

### 1. Create a Neon branch of production

Neon Console → your project → **Branches** → **Create branch**, from `main`.
Name it something disposable and dated, e.g. `phase2-rehearsal-20260727`.

Copy-on-write, so it is instant and carries real production data.

### 2. Put the branch URL in `.env.local`

```
NEON_BRANCH_URL="postgresql://...-pooler.<region>.aws.neon.tech/<db>?sslmode=require"
```

`.env.local` only — it is gitignored. Do not put it in `.env`, in a shell
history you keep, or in a commit.

### 3. Baseline the branch

```bash
node scripts/verify-schema.mjs --branch
```

**Expect:** the six new Phase 2 rows FAIL (the tables do not exist yet), every
Phase 0/1 row PASSes, `users.password_hash` reports nullable, and
`client_invites.token` PASSes the "must NOT exist" check trivially.

Record the row counts it prints for `users`, `investor_profiles`, `verdicts`.
Step 5 compares against them.

> A baseline where the Phase 2 rows already PASS means the branch was taken from
> something that already had them, or `NEON_BRANCH_URL` is pointing somewhere
> unexpected. Stop and find out which.

### 4. Run the migration against the branch

```bash
node --experimental-strip-types scripts/rehearse-migration.mts
```

This calls the real `ensureSchema()` — the same function production runs, invoked
deliberately rather than incidentally on a first request.

The script refuses to run if it cannot compare `NEON_BRANCH_URL` against
`DATABASE_URL`, and refuses if they resolve to the same database. That
comparison is on endpoint identity, not raw string, so Neon's pooled and direct
URLs for one branch are correctly treated as the same database
(`scripts/rehearse-migration.mts` `dbIdentity`). There is no flag that points it
at production.

**Expect:** `ensureSchema() completed in <n>ms`.

### 5. Verify

```bash
node scripts/verify-schema.mjs --branch
```

**Expect, all of:**

- All six Phase 2 rows PASS — `client_invites.token_hash`, `.expires_at`,
  `.accepted_at`, `.revoked_at`, `client_consents.policy_version`, `.disclosure`.
- `client_invites.token` still absent under **Must NOT exist**. If it is
  present, the raw-token design came back and this is a security regression, not
  a migration problem (`PHASE-2-INVITES-PLAN.md` §3.1).
- `users.password_hash` still nullable.
- Row counts for `users`, `investor_profiles`, `verdicts` **identical** to
  step 3. This wave touches no existing table, so any change at all means
  something ran that should not have.
- `client_invites` and `client_consents` both report `0`.

### 6. Confirm the app still works against the branch

The point of this step is the transaction risk described above: columns existing
proves the DDL ran, not that the application still functions.

Point a local dev server at the branch — temporarily set `DATABASE_URL` to the
branch URL **in your shell only**, not in `.env.local`:

```bash
DATABASE_URL="$NEON_BRANCH_URL" npm run dev
```

Then, as an ordinary solo investor account:

1. **Sign in.** This is the one that matters most. Phase 0 made
   `password_hash` nullable and `authorize()` guards on it
   (`src/lib/auth-guard.ts`); a schema batch that rolled back would surface
   here first.
2. Load `/dashboard` — verdict feed renders.
3. Load `/settings` — profile loads. With `OSPREY_AGENT_ACCOUNTS` unset, the
   agent card must **not** appear.
4. Save settings. Confirm the write succeeds and, per
   `src/lib/farm-enforcement.ts`, that nothing about an agent appears in the
   response for a user who has none.
5. Load a property page and confirm the authorization gate still behaves.

> Do **not** set `OSPREY_AGENT_ACCOUNTS=true` here. Ship gate #5 is unmet, and
> `POST /api/claim` will refuse anyway while `POLICY_VERSION` reads
> `PROVISIONAL`. If you want to exercise the agent paths against the branch,
> that is a separate rehearsal to run *after* the legal copy lands, and it needs
> its own section in this document.

### 7. Tear down

Delete the Neon branch in the Console. Remove `NEON_BRANCH_URL` from
`.env.local`.

Branches are copy-on-write off production data — a forgotten one is a full copy
of real user data sitting in a place nobody is thinking about.

---

## Production, afterwards

Not part of this rehearsal, and not to be done until every item in
`PHASE-2-INVITES-PLAN.md` §12 "Before this can ship" is met.

For the record, when it happens: `ensureSchema()` fires on the first request to
any route that calls it, so the migration lands on deploy without a manual step.
Confirm with:

```bash
node scripts/verify-schema.mjs
```

(no `--branch`), which reads schema metadata only and never touches user data.

---

## If something fails

| Symptom | Meaning |
|---|---|
| Rehearsal script exits 2, "refusing to run" | The safety guard worked. `NEON_BRANCH_URL` is unset, equals production, or `DATABASE_URL` is unavailable to compare. Fix the URL — do not work around the guard. |
| Verifier still FAILs Phase 2 rows after step 4 | `ensureSchema()` did not complete. Read its error; the transaction is all-or-nothing, so nothing landed. |
| Row counts changed | Stop. Nothing in this wave writes to those tables. Find out what did before going near production. |
| `client_invites.token` present | Raw-token storage was reintroduced. Security regression — see `PHASE-2-INVITES-PLAN.md` §3.1. |
| Sign-in broken at step 6 | The schema batch rolled back, or something outside this wave changed. Do not deploy. |
