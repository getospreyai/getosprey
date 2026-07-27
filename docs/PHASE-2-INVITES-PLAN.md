# Phase 2 — invite links + claiming (implementation plan, 2026-07-27)

Branch: `phase2-invites`. Base: `d23bfe2` (Phases 0–1 merged to master).

Read `docs/AGENT-ACCOUNTS-PLAN.md` §3, §3a, §3b, §7, §9, §9a first — this
document is the implementation-level expansion of the "Phase 2" row, not a
replacement for it. Where this document departs from the parent plan, the
departure is called out explicitly and justified.

**No implementation code has been written.** This is the plan only.

---

## 0. What Phase 2 is building on (state as of `d23bfe2`)

Landed and working:

| Piece | File | What it gives Phase 2 |
|---|---|---|
| `resolveScope()` / branded `SubjectId` | `src/lib/scope.ts` | Cross-user authorization. Phase 2 adds **zero** new authorization logic. |
| `resolveRequestScope()` | `src/lib/request-scope.ts` | Route-level entry point returning a bound `ScopedStore`. |
| `canAuthenticate()` / `canActAsViewer()` | `src/lib/auth-guard.ts` | Allowlist: only `status === 'active'` may hold a session. |
| `agent_clients` + one-active-agent index | `db/schema.sql:156-175` | The roster. `archived_at IS NULL` is the live check. |
| `agent_clients.client_email` | `db/schema.sql:190` | The client's **real** address, deliberately off `users.email`. |
| `createManagedClient()` | `src/osprey/pg-store.ts:431` | Atomic user + profile + roster insert; `status: 'managed'`, `password_hash: NULL`. |
| `withinFarm()` | `src/lib/farm-markets.ts:48` | Scan-cost control on client buy boxes. |
| `isScannable()` | `src/osprey/agent/scannable.ts:32` | Refuses to create a client the cron would silently skip. |
| `agentAccountsEnabled()` | `src/lib/features.ts:12` | Dark-ship flag. **Currently unset** in `.env.local` and `.env.example` — Phases 0–1 are live in code but invisible. |

Two observations from reading the tree that shape the plan below:

1. **`OSPREY_AGENT_ACCOUNTS` is not documented in `.env.example`.** Every other
   flag is. That should be fixed in this branch regardless — an undocumented
   flag is how a feature gets enabled by accident, or stays off by accident.
2. **The working tree on `master` shows all 59 files modified.** This is pure
   CRLF↔LF churn (`git diff --stat` reports 15819 insertions / 15819 deletions —
   exactly equal). There is no uncommitted work. Worth a `.gitattributes` with
   `* text=auto eol=lf` in a separate commit, because right now every real diff
   in this repo is unreadable.

---

## 1. The ship-gate question, answered directly

Ship gate #5 (`AGENT-ACCOUNTS-PLAN.md` §9a): *"Phase 2 does not ship without the
reviewed privacy/ToS update and a recorded consent step."*

This gate is **not satisfied** and nothing below treats it as satisfied. But it
is worth being precise about what it actually blocks, because "blocked on legal"
is often used to mean more than it should.

### Buildable now, on this branch

- The `client_invites` schema and its migration + verifier entries.
- Token mint / verify / accept / revoke lifecycle and all its tests.
- The agent-side "invite this client" API and UI (mint + copy link + revoke).
- The public `/claim/[token]` route and its landing state.
- The `client_consents` table and the consent-recording write path.
- The disconnect-from-agent path (§7 requirement, sets `archived_at`).
- The full authz matrix extension for every new route.
- The farm-market regression fix (§7 below) — independently valuable.

### Genuinely blocked by gate #5

- **Flipping `OSPREY_AGENT_ACCOUNTS=true` in production.** That is the ship, and
  it is the thing the gate actually stops.
- **The consent screen's copy.** The gate requires a screen "naming exactly what
  the agent can see, not buried in ToS" (§3b). The *list* of what an agent can
  see is knowable today from `ScopedStore`'s surface — buy box, financing,
  cash-flow bar, verdict feed, property files. But the wording is a legal
  artifact and must match the reviewed Privacy Policy §-for-§, or the recorded
  consent is to text that contradicts the policy it points at.
- **`POLICY_VERSION`.** The consent row must record *which* version of the
  policy was agreed to (§4 below). That constant cannot be finalized until the
  re-dated policy exists. Build the column; leave the constant provisional and
  fail the build if it is still provisional when the flag is on.
- **Privacy Policy + ToS agent-relationship sections and new effective date.**
  Both currently read `July 21, 2026` (`src/app/privacy/page.tsx:19`,
  `src/app/terms/page.tsx:10`). Neither mentions agents. This is writing +
  review work, not engineering.

**Recommended sequencing:** build the mechanism, land it behind the flag, and
make the *code itself* refuse to run the accept path while the policy version is
provisional (see §4.4). That way the gate is enforced by a test rather than by
someone remembering.

---

## 2. Two flows, deliberately separated

The parent plan's `client_invites` table implies one flow. There are actually
two, and conflating them is exactly threat **T7** ("silent linking of an existing
account to an agent").

### Flow A — claiming a `managed` client (the common case)

The `users` row already exists (`status: 'managed'`, `password_hash: NULL`,
synthetic email `managed-<uuid>@clients.osprey.invalid`). The client sets a
password and a real email; `status` → `'active'`.

### Flow B — linking an **existing** Osprey account to an agent

The person already has an account. There is no row to claim. Clicking a token
must do *nothing* except present a consent screen to a **signed-in** user, who
then explicitly agrees to the linkage. Per §3b: *"Clicking a token is never
consent to expose an existing account."*

**Recommendation: build Flow A only in this phase, and have Flow B's entry point
detect the case and refuse with a clear message** ("This email already has an
Osprey account — ask them to sign in and connect from Settings"). Reasons:

- Flow B needs an in-app inbox/notification surface the product does not have.
- Flow B collides with `agent_clients_one_active_agent` (`db/schema.sql:174`) if
  the user already has an agent — a raw 23505 today.
- It doubles the consent surface for a flow with no user demand yet.

Defer Flow B to Phase 2b with its own consent design. Note this explicitly in
the parent plan so it is a decision, not an omission.

---

## 3. Schema

Additive only, mirrored in **both** `src/lib/db.ts` `ensureSchema()` and
`db/schema.sql` (they are hand-synced — see the header comment at
`db/schema.sql:18`), plus `EXPECTED` in `scripts/verify-schema.mjs` **in the same
commit** (§9b of the parent plan).

### 3.1 `client_invites` — departing from the parent plan on one point

```sql
CREATE TABLE IF NOT EXISTS client_invites (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash     TEXT NOT NULL UNIQUE,   -- sha256(token), NOT the token
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  email          TEXT NOT NULL,          -- mirrors agent_clients.client_email at mint time
  expires_at     TIMESTAMPTZ NOT NULL,
  accepted_at    TIMESTAMPTZ,
  revoked_at     TIMESTAMPTZ,
  created_at     TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_invites_agent_idx  ON client_invites (agent_user_id);
CREATE INDEX IF NOT EXISTS client_invites_client_idx ON client_invites (client_user_id);

-- At most one outstanding invite per client. Prevents an agent accumulating a
-- pile of live tokens for the same person, each an independent theft target.
CREATE UNIQUE INDEX IF NOT EXISTS client_invites_one_outstanding
  ON client_invites (client_user_id)
  WHERE accepted_at IS NULL AND revoked_at IS NULL;
```

**Departure from `AGENT-ACCOUNTS-PLAN.md` §3:** the parent plan has
`token TEXT PRIMARY KEY` — the raw token as the key. Store a **SHA-256 hash**
instead.

Rationale: a raw invite token in the database is a bearer credential for
becoming another person's account. Anything that can read the table — a backup,
a log of a slow query, a Neon branch handed to a contractor, an SQL injection
anywhere in the app — becomes account takeover for every outstanding invite.
Hashing costs one `crypto.createHash` call on a lookup that is already indexed,
and makes the table useless to a reader. This is the standard treatment for
password-reset tokens and there is no reason invites differ.

SHA-256 without a salt/KDF is correct here specifically because the token is
256 bits of CSPRNG output — there is no dictionary to attack, so the slow-hash
argument that applies to passwords does not apply. Do not "improve" this to
bcrypt; bcrypt's 72-byte truncation and cost factor buy nothing against a
random 256-bit secret.

**Also departing:** `revoked_at` is added (parent plan has only `accepted_at`).
An agent who sends a link to the wrong number needs to kill it, and
"accepted" and "revoked" must be distinguishable in the audit trail.

`share_links` (`db/schema.sql:87`) stores raw tokens, which is defensible — a
share link exposes one read-only property view, not an account. Do not use it as
the precedent here.

### 3.2 `client_consents` — the recorded consent step (ship gate #5)

```sql
-- The recorded consent required by ship gate #5. Append-only: a withdrawal is
-- a new row (kind 'withdraw'), never an UPDATE or DELETE, because the question
-- this table answers is "what did they agree to, and when" — which a mutable
-- row cannot answer after the fact.
CREATE TABLE IF NOT EXISTS client_consents (
  id             BIGSERIAL PRIMARY KEY,
  user_id        UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  agent_user_id  UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind           TEXT NOT NULL,   -- 'agent_access' | 'withdraw'
  policy_version TEXT NOT NULL,   -- e.g. '2026-08-01' — WHICH text they agreed to
  disclosure     TEXT NOT NULL,   -- verbatim copy of the screen they were shown
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS client_consents_user_idx ON client_consents (user_id, created_at DESC);
```

`disclosure` stores the **verbatim text shown**, not a reference to it. A
pointer to copy that lives in a `.tsx` file is worthless a year later when the
copy has changed — the record must be self-contained to be evidence of anything.
It is a few hundred bytes per claim.

Deliberately **not** stored: IP address and user-agent. They are tempting as
"proof" but they are additional personal data collected about a person at the
exact moment we are promising them a minimal-collection posture, and Privacy
Policy §2 does not currently disclose collecting them for this purpose. If legal
review asks for them, add them there and in the policy together.

### 3.3 `users` — no change

`status` already permits `'invited'` via `users_status_check`
(`db/schema.sql:196`). Nothing to migrate.

### 3.4 Verifier entries

Add to `EXPECTED` in `scripts/verify-schema.mjs` in the migration commit:

```js
// Wave: agent accounts phase 2 (2026-07-27).
["client_invites", "token_hash"],
["client_invites", "expires_at"],
["client_invites", "accepted_at"],
["client_invites", "revoked_at"],
["client_consents", "policy_version"],
["client_consents", "disclosure"],
```

Migration rehearsal per §9b — Neon branch, baseline, exercise `ensureSchema()`,
re-verify, confirm row counts unchanged. This wave is pure `CREATE TABLE`, so it
is materially lower risk than Phase 0's `users` ALTERs; rehearse anyway.

---

## 4. Token lifecycle

### 4.1 Mint

New module `src/lib/invite-token.ts`:

```ts
/** 256 bits of CSPRNG, base64url. Never stored — only its hash is. */
export function mintInviteToken(): { token: string; tokenHash: string };
export function hashInviteToken(token: string): string;   // sha256 hex
export const INVITE_TTL_DAYS = 7;
```

**Entropy — departing from the parent plan.** §3a T6 specifies
`crypto.randomUUID()`. Use `crypto.getRandomValues(new Uint8Array(32))` instead.

`randomUUID()` is a v4 UUID: 122 bits of randomness, and 6 of its 128 bits are
fixed version/variant markers. 122 bits is not brute-forceable and the parent
plan is not *wrong*. But there is no cost to 256 bits, and a v4 UUID has a
specific liability here: it *looks* like an identifier, so it is the kind of
value that ends up logged, put in a URL that gets pasted into a support ticket,
or reused as a database key by a future change. A `tok_`-prefixed opaque blob
reads as a secret to everyone who sees it, including future maintainers. Prefix
the string so it is greppable in logs if it ever leaks into one.

TTL 7 days. The agent hands the link over directly (§9 "no email
infrastructure") so there is no deliverability lag to accommodate; 7 days is
generous for "I'll text it to them tonight."

### 4.2 States

```
mint ──> outstanding ──accept──> accepted (terminal)
             │
             ├──expiry (implicit, expires_at < now)
             └──revoke──> revoked (terminal)
```

Every state is derived from timestamps; no status column, so there is no way for
a status column and its timestamps to disagree.

**Single-use enforcement must be atomic.** Do not read-then-write. The accept is
one conditional UPDATE whose `WHERE` clause *is* the validity check, and the
transaction proceeds only if it affected a row:

```sql
UPDATE client_invites
   SET accepted_at = now()
 WHERE token_hash  = $1
   AND accepted_at IS NULL
   AND revoked_at  IS NULL
   AND expires_at  > now()
RETURNING agent_user_id, client_user_id, email
```

Zero rows returned → refuse, identically for every reason (§5). This makes two
simultaneous clicks on the same link resolve to exactly one winner at the
database level, with no application-level locking.

### 4.3 Invalidation

- On accept — by the UPDATE above.
- On revoke — `revoked_at = now()`, agent-initiated.
- On client archive (agent removes client) — revoke all outstanding invites in
  the same transaction. Otherwise a live token outlives the relationship it was
  minted under and re-creates it on click.
- On expiry — implicit. A cleanup job is not needed at this volume; if one is
  added later it must delete only rows past expiry *and* past a retention
  window, not truncate the table, since accepted rows are the audit trail.

### 4.4 Policy-version guard

`src/lib/legal.ts` gains:

```ts
/** The policy version a consent record is written against. MUST match the
 *  effective date on /privacy and /terms. */
export const POLICY_VERSION = "PROVISIONAL";
```

and the accept path refuses to run when it is `"PROVISIONAL"`. A unit test
asserts `POLICY_VERSION !== "PROVISIONAL"` **only when**
`OSPREY_AGENT_ACCOUNTS === "true"`, so the branch stays green while dark and the
gate becomes impossible to forget at flip time. `EFFECTIVE_DATE` is currently
duplicated in `src/app/privacy/page.tsx:19` and `src/app/terms/page.tsx:10`;
hoist both into `src/lib/legal.ts` alongside it so the three cannot drift.

This is the mechanism that turns ship gate #5 from a note in a document into a
failing test.

---

## 5. Routes

Following the existing conventions exactly: `agentAccountsEnabled()` first,
`resolveRequestScope()` second, `NO_STORE` on every response, identical refusals.

### 5.1 `POST /api/clients/[clientId]/invite` — mint (agent)

```
1. agentAccountsEnabled() else 404
2. resolveRequestScope(clientId)   ← the ONLY authorization; no new logic
3. scope.relation === 'agent_of_client' else 404      (self-invite is meaningless)
4. scope.canEdit else 404                             (already-claimed client)
5. client status === 'managed' else 400
6. agent_clients.client_email present else 400        (nothing to address it to)
7. revoke any outstanding invite, insert new, set users.status = 'invited'
   — one transaction
8. return { url: `${origin}/claim/${token}`, expiresAt }
```

Step 8 returns the raw token **exactly once**, in the mint response, and it is
never retrievable again. If the agent loses it they re-mint, which revokes the
old one. This falls out of storing only the hash and is the right behavior
independently.

**URL construction — a small departure from the share-link precedent.**
`src/app/api/property/[listingId]/share/route.ts:36` returns a *relative* path
(`/r/${token}`) and lets the client build the absolute URL. That works there
because the share UI renders a link in place. It does not work here: the agent
needs an absolute URL to paste into a text message. Build it from
`req.nextUrl.origin` (not an env var, so preview deployments produce working
links) and return `{ url, expiresAt }`.

### 5.2 `DELETE /api/clients/[clientId]/invite` — revoke (agent)

Same guard chain. Sets `revoked_at`, and reverts `users.status` `'invited'` →
`'managed'` so the roster badge (`src/app/clients/page.tsx:19-33`, which already
renders an "Invited" state) stays truthful.

### 5.3 `GET /claim/[token]` — public landing page

**This route is unauthenticated and must stay that way.** Concretely: do **not**
add `/claim/:path*` to the matcher in `src/proxy.ts` — that file currently
redirects any unmatched-but-listed path to `/login`, which would make the claim
link unusable for exactly the people it is for. The matcher stays:

```
"/dashboard/:path*", "/settings/:path*", "/onboarding/:path*", "/clients/:path*"
```

The page looks the token up read-only and renders one of two things, and only
two:

- **Valid** → the claim form (§6) with the agent's name, the client's name, and
  the consent disclosure.
- **Anything else** → one identical "This link isn't valid anymore" state for
  expired, revoked, accepted, malformed, and never-existed. Same as
  `resolveScope`'s T4 discipline: no oracle for which tokens exist.

Nothing about the client is rendered before validity is confirmed. `robots`
`noindex` on the route, and no token in any client-side analytics.

### 5.4 `POST /api/claim` — accept

The security-critical route. `{ token, email, password, consent: true }`.

```
1. agentAccountsEnabled() else 404
2. POLICY_VERSION !== 'PROVISIONAL' else 503        (§4.4 — the ship gate)
3. consent === true else 400                        (no implicit consent)
4. validate email shape, password >= 8              (matching src/app/api/signup/route.ts:69)
5. atomic single-use UPDATE (§4.2); zero rows -> generic refusal
6. bcrypt.hash(password, 10)                        (cost 10, matching signup)
7. transaction:
     UPDATE users SET email=?, password_hash=?, status='active' WHERE id=? AND status='invited'
     INSERT INTO client_consents (...)
     UPDATE investor_profiles SET profile = jsonb_set(profile,'{setUpByAgent}','true')
8. return { ok: true } — do NOT auto-sign-in; redirect to /login
```

**Step 7's email collision is the sharpest edge in this phase.** `users.email` is
`UNIQUE` (`db/schema.sql:24`). The claimer may enter an address that already has
an Osprey account. That insert raises 23505, and how it is handled decides
whether this route is an email-enumeration oracle.

Options, and the recommendation:

- ❌ *"That email is already registered"* — a clean enumeration oracle, and worse
  than signup's equivalent (`src/app/api/signup/route.ts:96`) because signup at
  least requires `SIGNUP_INVITE_CODE`. An invite token holder is an outsider.
- ❌ Silently link the existing account to the agent — this is **T7** verbatim.
  Never.
- ✅ **Refuse generically and route to support.** *"We couldn't finish setting up
  this account. Please contact your agent."* Log the real reason server-side.
  The claimer holds a token for a *different* account than the one they typed an
  address for; there is no safe automatic resolution, and the population hitting
  this is small (an existing user whose agent also created a managed row).

Cost: a real user with an existing account hits a dead end. That is the correct
trade against an enumeration oracle on an unauthenticated endpoint, and it is
the case Flow B (§2) exists to solve properly later.

**Also step 7:** the guard `AND status='invited'` in the users UPDATE is the
second half of single-use. The invite UPDATE already won the race, but this makes
the user-row transition idempotent against any path that flips status.

**No auto-sign-in.** Tempting for UX, but it means an unauthenticated endpoint
mints a session, and the claimer has just chosen a password they should
immediately prove they can use. Redirect to `/login`.

**Rate limiting:** this repo has no rate-limiting infrastructure. At 256 bits,
token guessing is not a real threat, so this is acceptable. But `/api/claim` is
the first unauthenticated, state-changing, bcrypt-invoking endpoint in the app —
bcrypt cost 10 makes it a cheap CPU-exhaustion target. Recommend ordering the
handler so the invite lookup (indexed, sub-millisecond) happens **before**
`bcrypt.hash`, which the sequence above already does. Note it as a follow-up, not
a blocker.

### 5.5 `POST /api/clients/[clientId]/disconnect` — the §7 requirement

§7 requires "an `active` client needs a **disconnect from agent** path." This is
the client acting on themselves, not the agent:

```
1. resolveRequestScope()          ← self scope, no clientId
2. find the active agent_clients row where client_user_id = self
3. set archived_at = now()
4. INSERT client_consents (kind: 'withdraw')
```

`resolveScope` already refuses once `archived_at` is set
(`src/lib/scope.ts:107`) — threat T8 is handled by code that already exists and
already has a test (`tests/scope.test.ts:97`). Surface it in
`src/app/settings/page.tsx` for any user with an active agent link.

§3b's "a defined policy for reports and share links the agent already created"
is a **policy question for the legal pass, not code**: do reports the agent
generated survive disconnection? Recommendation to put to review — yes, they
remain the agent's (they are the agent's work product about a listing), but the
client's *feed and buy box* become inaccessible. Get this decided in writing
before the flag flips.

---

## 6. The claiming flow, end to end

```
Agent                          Osprey                        Client
  │                              │                              │
  ├─ "Invite" on /clients/[id] ─>│                              │
  │                              ├─ mint, status -> 'invited'   │
  │<─ https://…/claim/tok_xxx ───┤                              │
  │                                                             │
  ├─ sends the link themselves (text/email/in person) ─────────>│
  │                                                             │
  │                              │<── GET /claim/tok_xxx ───────┤
  │                              ├─ validate, render form ─────>│
  │                              │                              │
  │                              │<── POST /api/claim ──────────┤
  │                              │    {email, password, consent}│
  │                              ├─ single-use UPDATE           │
  │                              ├─ status -> 'active'          │
  │                              ├─ record consent              │
  │                              ├─ redirect /login ───────────>│
  │<─ roster badge: "Claimed"    │                              │
  │   canEdit -> false           │                              │
```

The `canEdit` flip needs **no new code**: `resolveScope` already returns
`canEdit: link.clientStatus !== "active"` (`src/lib/scope.ts:162`), `ScopedStore`
already throws on write in a read-only scope, and
`src/app/clients/[clientId]/page.tsx:79-82` already renders both states. This is
Phase 0 paying off — the hardest part of Phase 2 was built in advance.

### The consent screen

Rendered on `/claim/[token]` above the form, checkbox unticked, submit disabled
until ticked. Content (final wording pending legal review — this is the
*substance*, drawn from `ScopedStore`'s actual surface, not the final copy):

> **[Agent name] set up this account for you.**
> Once you claim it, they will be able to see: your buy box, your financing
> assumptions, your minimum cash-flow target, every listing Osprey underwrites
> for you, and any property reports you generate.
> They **cannot** change your email or password, delete your account, or see
> your login history.
> You can disconnect from your agent at any time in Settings.

The last two lines are load-bearing and both are true today —
`ScopedStore`'s surface (`src/lib/scoped-store.ts:56-165`) has no method that
touches credentials, and §5.5 delivers the disconnect. Do not ship this copy if
either stops being true.

### `setUpByAgent` label

§7 requires buy boxes created by an agent be labelled "set up by your agent."
Set the flag on the profile JSONB at claim time (step 7 above) and render it in
`src/app/settings/page.tsx` and `src/components/SettingsForm.tsx`. Add it to
`PatchProfileSchema` in `src/lib/profile-schema.ts` as a server-controlled
field — the client must not be able to set or clear it via `PATCH /api/profile`.

---

## 7. The regression Phase 2 introduces (not in the parent plan)

**A claimed client can break the farm-market cost invariant.**

`withinFarm()` is enforced in exactly two places (`grep withinFarm src/`):
`src/app/api/clients/route.ts:105` (agent creates a client) and
`src/app/api/agent/settings/route.ts:75` (agent edits their farm). It is **not**
enforced in `src/app/api/profile/route.ts`, because until Phase 2 no
agent-sourced profile was ever self-edited.

The moment a client claims, they own their buy box and edit it through
`PATCH /api/profile`. They can move it to Honolulu. The agent's farm — the whole
cost control from §2 decision 1 — is now bypassed, and each escaped client adds a
full paginated RentCast pull (~12–20 calls) to a cron with `maxDuration = 60`.
The failure is silent: `OSPREY_MAX_MARKETS` (default 5) truncates, and while
Phase 0 made dropped markets *recordable* (`scan_runs.markets_dropped`), nobody
is alerted.

This is a genuine Phase 2 blocker for correctness, not a nice-to-have. Options:

1. **Enforce `withinFarm` in `/api/profile` when the user has an active agent
   link.** Cheapest. But it means a claimed client — who was just told they own
   their data — cannot move their own buy box, which contradicts §2 decision 3.
2. **Let them leave the farm, and auto-disconnect from the agent when they do.**
   Coherent with the privacy story: leaving your agent's market ends the
   relationship. Needs clear UI.
3. **Let them leave, and count out-of-farm claimed clients against a per-agent
   budget**, surfaced on `/clients`. Most flexible, most work.

**Recommendation: (2)**, with an explicit confirmation. It is the only option
that keeps both the cost invariant and the "you own your data after claiming"
promise. Needs Dylan's decision — it is a product call with a privacy dimension,
not a technical one.

---

## 8. Security summary, mapped to the threat model

| Threat | Phase 2 control | Where |
|---|---|---|
| **T6** invite token theft/guess | 256-bit CSPRNG; **hash stored, never the token**; 7-day expiry; atomic single-use UPDATE; revocable; revoked on client archive | §3.1, §4 |
| **T7** silent linking of existing account | Flow B not built; existing-email claim refused generically; consent required and recorded | §2, §5.4 |
| **T4** existence leak | One identical invalid-link state for all failure modes; generic refusal on email collision; `/claim` never renders client data pre-validation | §5.3, §5.4 |
| **T2** attacker-supplied ids | Every agent-side route goes through `resolveRequestScope(clientId)`; **zero new authorization logic** | §5.1, §5.2 |
| **T3** auth bypass on null hash | Unchanged — `canAuthenticate()` already refuses. Claim sets a real bcrypt hash before flipping to `'active'`, in one transaction, so no window exists where a row is `'active'` with a NULL hash | `src/lib/auth-guard.ts` |
| **T8** agent retains access post-disconnect | `archived_at` + existing `resolveScope` check; disconnect surfaced in Settings | §5.5 |
| **T10** invite spam | Unchanged — Osprey sends nothing; the agent delivers the link | parent §9 |

New audit surface added by this phase: **one** unauthenticated state-changing
endpoint (`POST /api/claim`) and **one** unauthenticated read (`GET /claim/[token]`).
That is the entire increase, and both are listed here so the next review can
find them.

`grep systemSubject` must return the same results after this phase as before it.
Phase 2 introduces **no** new authorization bypass. If a patch needs
`systemSubject()`, that patch is wrong.

---

## 9. Tests

Extend `tests/` in the existing style (`tests/scope.test.ts` is the model — pure
functions with injected deps, no database).

**`tests/invite-token.test.ts`** (new)

- token is ≥256 bits and unique across 10k mints
- `hashInviteToken` is stable, and the raw token never appears in what is stored
- expiry boundary: `expires_at` exactly now → invalid

**`tests/invite-lifecycle.test.ts`** (new, injected-deps)

- accept once succeeds; **second accept of the same token fails**
- expired / revoked / accepted / malformed / nonexistent → **byte-identical refusal**
- archiving a client revokes its outstanding invites
- revoke reverts `users.status` `'invited'` → `'managed'`
- the accept path refuses while `POLICY_VERSION === 'PROVISIONAL'`

**`tests/scope.test.ts`** (extend)

- `canEdit` is false immediately after status flips to `'active'` — already
  covered at line 177; add the claim-transition case explicitly

**Authz matrix for the new routes** (ship gate #1) — mint, revoke, and disconnect
each asserted against: self ✓, own client ✓, other agent's client ✗, non-agent ✗,
archived relationship ✗, forged id ✗, **with identical responses for forbidden
and nonexistent**.

**Characterization** (ship gate #3): a solo investor's `PATCH /api/profile` is
unchanged — this is what catches §7's farm-market fix if it is implemented as
option (1) and accidentally applied to users with no agent.

---

## 10. Commit sequence

Each commit builds clean (`npm run build`), passes `npm test`, and is
independently deployable. The flag stays off throughout.

1. `.gitattributes` (`* text=auto eol=lf`) + normalize. Nothing else — this
   commit is huge and mechanical and must not hide anything.
2. Document `OSPREY_AGENT_ACCOUNTS` in `.env.example`.
3. Schema: `client_invites` + `client_consents` in `ensureSchema()` **and**
   `db/schema.sql` **and** `verify-schema.mjs` `EXPECTED`. Rehearse on a Neon
   branch (§9b) before this reaches prod.
4. `src/lib/invite-token.ts` + tests. Pure functions, no routes.
5. `POLICY_VERSION` in `src/lib/legal.ts`, `EFFECTIVE_DATE` hoisted from both
   legal pages, provisional-guard test.
6. `PgStore` invite methods (mint/lookup/accept/revoke) + `client_consents`
   writer.
7. `POST` / `DELETE /api/clients/[clientId]/invite` + authz matrix tests.
8. `GET /claim/[token]` + `POST /api/claim` + lifecycle tests.
9. Disconnect path + Settings surface.
10. `setUpByAgent` label.
11. **Farm-market decision from §7** — separate commit, whichever option Dylan
    picks.

Legal copy (Privacy Policy + ToS agent sections, new effective date) is a
parallel track. `POLICY_VERSION` flips off `PROVISIONAL` in the commit that lands
the reviewed copy — and that commit is the one that unblocks the flag.

---

## 11. Decisions

### Settled (Dylan, 2026-07-27) — all built

1. **§7 farm markets after claim → auto-disconnect.** A claimed client who
   moves their buy box outside their agent's farm is disconnected from that
   agent rather than being refused the edit. Enforced at the mutation points
   (`PATCH /api/profile`, `POST /api/onboarding/complete`), not only where
   `withinFarm` already appeared. Observable on both sides: the client gets a
   persistent banner in Settings from the write that caused it, and the agent
   gets a "recently disconnected" section on `/clients` with the reason drawn
   from the consent ledger. → `src/lib/farm-enforcement.ts`,
   `tests/farm-enforcement.test.ts`.
2. **§5.4 email collision → generic refusal.** No enumeration signal, no
   silent linking, routed to support. Because `claimInvite()` is a single
   statement, the rollback leaves the invite outstanding, so the claimer can
   retry with a different address instead of holding a spent link.
3. **§2 Flow B deferred** to a Phase 2b with its own consent design.
4. **§3.1 token storage → sha256**, and **32 random bytes** rather than
   `crypto.randomUUID()`.
5. **§3.2 consent metadata → no IP/user-agent** unless legal review asks.
6. **§4.4 `POLICY_VERSION = "PROVISIONAL"`** with the claim path refusing to
   run against it and a test that fails only when the flag is on.

### Still open

**Do the agent's reports and share links survive a disconnect?** (§5.5)

Unanswered, and deliberately not blocking the build. It gates the legal copy,
and therefore the flag — not any code that has been written.

Where the decision lands, concretely:

| If the answer is… | What changes |
|---|---|
| Reports stay with the agent (recommended) | Nothing in code. `property_reports` is keyed `(user_id, listing_id)` and the agent's own rows are already theirs; `disconnectAgent()` does not touch them. |
| Reports must be revoked on disconnect | One statement added to the `disconnectAgent()` transaction in `src/osprey/pg-store.ts`, alongside the existing invite revocation. |
| Share links must be revoked on disconnect | One statement in the same transaction: `UPDATE share_links SET revoked = true WHERE user_id = <client>`. |

All three are a single transaction in one method, which is why this was worth
structuring for rather than waiting on. Whatever is decided must also be
written into the Privacy Policy's agent section — §3b requires "a defined
policy for reports and share links the agent already created," and a policy
that exists only in code is not a defined policy.

---

## 12. Build status (2026-07-27)

Branch `phase2-invites`, 12 commits on top of `d23bfe2`. Not merged, not
deployed, flag not flipped.

- 199 tests passing (was 114 on `master`); `tsc --noEmit` and `eslint` clean.
- `npm run build` could not be verified in the sandbox: `next build` fails
  fetching Geist, Geist Mono, and Instrument Serif from Google Fonts, which
  the environment cannot reach. Those imports are in `src/app/layout.tsx`,
  untouched by this branch, and the build reports no other errors. **Needs one
  local `npm run build` to confirm.**
- `grep systemSubject` returns the same results as before this branch. Phase 2
  adds no authorization bypass.
- New unauthenticated surface, in full: `GET /claim/[token]` (read) and
  `POST /api/claim` (write). Nothing else.

### Before this can ship

Drafts for 1-2 and the runbook for 4 now exist; none of it is executed or final.

1. Reviewed Privacy Policy + ToS with an agent-relationship section, re-dated.
   → working draft in **`docs/PRIVACY-TOS-AGENT-DRAFT.md`**. Read its §A first:
   six findings from the code that were not part of any prior discussion, four
   of which may be cheaper to fix than to disclose.
2. `POLICY_VERSION` and `EFFECTIVE_DATE` set to that date in
   `src/lib/legal.ts`; `AGENT_ACCESS_DISCLOSURE` reworded to match it section
   for section. → consent copy draft in
   **`docs/CONSENT-SCREEN-COPY-DRAFT.md`**; the full list of code changes this
   forces is in `PRIVACY-TOS-AGENT-DRAFT.md` §E.
3. Decision on reports/share links above, reflected in both the policy and (if
   it is not the recommended answer) `disconnectAgent()`. Both drafts mark every
   affected sentence `[DECISION-3]` — they should not go to a reviewer with
   those brackets unresolved.
4. Migration rehearsed on a Neon branch per §9b — this wave is pure
   `CREATE TABLE`, so lower risk than Phase 0's `users` ALTERs, but rehearse
   anyway. → step-by-step runbook in
   **`docs/PHASE-2-MIGRATION-REHEARSAL.md`**. Not executed.
5. `npm run build` locally. Still unverified here; see below.
6. Only then `OSPREY_AGENT_ACCOUNTS=true`.

### `npm run build` — what would need to be true to verify it

Retried 2026-07-27; still fails identically. All three errors are
`next/font` fetching Geist, Geist Mono, and Instrument Serif from
`fonts.googleapis.com`, imported by `src/app/layout.tsx` — a file no commit on
this branch touches. No other error is reported, and `tsc --noEmit` and
`eslint` are both clean across `src` and `tests`.

To verify, one of:

- run `npm run build` on a machine with outbound access to
  `fonts.googleapis.com` (i.e. Dylan's laptop, or CI), **or**
- allow `fonts.googleapis.com` and `fonts.gstatic.com` in the sandbox's network
  policy.

Not worth working around in code — swapping to local font files to satisfy a
sandbox would be a real change to production rendering made for a fake reason.

### Known gaps, deliberately left

- **No rate limiting on `POST /api/claim`.** Acceptable against a 256-bit
  token; the mitigation for the bcrypt cost is ordering (invite lookup first).
  Worth revisiting if any other unauthenticated write is ever added.
- **No agent-side editing of a claimed client's buy box**, which is correct —
  `canEdit` goes false — but there is also still no edit path for a *managed*
  client's buy box after creation. That predates Phase 2.
- **Flow B** (existing account linking) is unbuilt; the claim route refuses
  that case generically rather than handling it.
