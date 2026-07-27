# Admin UI — scope (2026-07-26)

Operator tooling for Osprey. Scoped after Phases 0–1 of agent accounts shipped
dark to production.

Read this whole file before writing code. The auth model and the privacy
boundary are deliberate and are the two things most likely to be "simplified"
into a much worse product.

---

## 1. Why this exists

One thing is genuinely blocking: **nothing can grant `role = 'agent'`.** Making
someone an agent today is a manual `UPDATE users` against production.

Two capabilities are already built and have nothing to drive them:

- `users.status` supports suspension, and `canActAsViewer()` allowlists
  `'active'` — so **suspension takes effect immediately** once something can set
  it. The revocation path exists and has never been exercised in anger.
- The cron records `markets_dropped`, and nothing reads it.

And one real bottleneck: signup is gated by a **single shared
`SIGNUP_INVITE_CODE`** env var, so converting a waitlist signup into an account
is entirely manual.

## 2. Decisions taken (confirmed with Dylan, 2026-07-26)

1. **Auth: environment allowlist**, not a database role.
2. **Visibility: account metadata only.** No financial data.
3. **v1 mutations:** promote/demote agent, suspend/reactivate, waitlist → invite.

---

## 3. Auth model — env allowlist

```
OSPREY_ADMIN_EMAILS=dylaan.cannon@gmail.com     # comma-separated
```

Admin = **authenticated** AND session email in the allowlist, re-checked
server-side on every request. Never trust the JWT for this, for the same reason
`role` is nav-only (AGENT-ACCOUNTS-PLAN.md §3a T5).

**Why not `role = 'admin'`:** it makes the highest privilege in the system
DB-writable. Any SQL-injection path, compromised credential, or bug in a future
admin mutation could escalate to full admin. An env allowlist cannot be
escalated from inside the application, is revocable without deploying code, and
leaves no admin flag in the database to leak. The cost — adding an admin means
an env change — is the right trade at this size.

Implement as a single guard mirroring `resolveRequestScope()`:

```ts
// src/lib/admin.ts
export function adminEmails(): string[]          // parsed, lower-cased
export async function requireAdmin(): Promise<AdminResult>
```

`AdminResult` must distinguish `unauthenticated` from `not_admin`, and **every
admin route returns 404 for both** — an admin surface should not confirm its own
existence to a signed-in non-admin.

Gate the whole surface behind its own flag (`OSPREY_ADMIN_UI`) so it ships dark
like agent accounts.

## 4. Privacy boundary — load-bearing

**Admin MAY see (account metadata):** email, name, role, status, created_at,
whether Telegram is bound, client count, last sign-in if available.

**Admin MAY NOT see (financial data):** buy box, financing profiles, cash-flow
bar, verdicts, property analysis, reports, share links.

This line is what keeps the admin UI *outside* the privacy/ToS re-review that
agent-accounts Phase 2 already requires. Crossing it — even "read-only buy box
for debugging" — turns this into a privacy-policy change. If that becomes
necessary, treat it as its own decision with its own copy review, not a
convenience patch.

**Impersonation is out of scope.** It is the single largest privacy expansion
available in this product and needs consent language, audit logging, and a
persistent session banner before it could ship responsibly.

## 5. Schema

```sql
-- Append-only. No update or delete path, ever — an audit log you can edit is
-- not an audit log.
CREATE TABLE IF NOT EXISTS admin_audit (
  id           BIGSERIAL PRIMARY KEY,
  actor_email  TEXT NOT NULL,         -- from the allowlist, not a user id
  action       TEXT NOT NULL,         -- 'promote_agent' | 'suspend' | 'invite' | ...
  target_user  UUID,                  -- nullable: some actions have no user target
  detail       JSONB,
  created_at   TIMESTAMPTZ DEFAULT now()
);
CREATE INDEX IF NOT EXISTS admin_audit_created_idx ON admin_audit (created_at DESC);
```

Suspension needs the existing constraint widened:

```sql
-- users_status_check currently allows ('active','managed','invited').
-- Drop and recreate including 'suspended'.
```

Add every new column to `EXPECTED` in `scripts/verify-schema.mjs` in the same
commit, and rehearse on a Neon branch first (ship gate #4).

## 6. Invites — build ONE mechanism, not two

Admin v1 needs waitlist → invite. Agent-accounts **Phase 2** needs client
invites. These look different but are the same primitive with different
outcomes:

| | Admin invite | Agent client invite |
|---|---|---|
| Issued by | admin | agent |
| Creates | a brand-new account | claims an EXISTING managed user |
| Delivery | link, given to the person | link, delivered by the agent |

Build a single `invites` table with a `kind` discriminator
(`'signup' | 'client_claim'`) and a nullable `target_user_id`, rather than
`client_invites` plus a separate admin table. Same token generation, expiry,
single-use semantics, and revocation for both.

**No email provider.** Same reasoning as AGENT-ACCOUNTS-PLAN.md §9: the admin
copies a link and sends it. That removes CAN-SPAM/TCPA surface, deliverability,
a vendor, and the invite-spam vector — and we never contact someone who has
never heard of us.

Retiring `SIGNUP_INVITE_CODE` in favour of per-invite tokens is a strict
security improvement: a shared code cannot be revoked per-person, has no expiry,
and cannot be attributed.

## 7. Surface

| Route | Purpose |
|---|---|
| `/admin` | User list: metadata columns, filter by role/status |
| `/admin/users/[id]` | One user's metadata + audit history; role and status actions |
| `/admin/waitlist` | Waitlist signups; mint an invite link per row |
| `/admin/scans` | (v2) dropped markets, last run, coverage gaps |

Mutations are POST routes under `/api/admin/*`, each `requireAdmin()`-gated and
each writing an `admin_audit` row **in the same transaction as the change** — an
audit write that can fail independently will eventually be missing exactly the
row that matters.

## 8. Guardrails

1. An admin must not be able to suspend or demote **themselves** — trivially
   locks the operator out of their own tooling. Refuse with a clear message.
2. Every mutation writes `admin_audit` atomically with the change.
3. Admin routes 404 (never 403) for signed-in non-admins.
4. No delete-user action in v1. Deletion is irreversible, interacts with
   `ON DELETE CASCADE` across verdicts/profiles/roster rows, and deserves its
   own design.
5. Suspension must be verified to actually revoke: suspend a test account on a
   Neon branch, confirm its existing session stops working on the next request
   (this is the `canActAsViewer` path).

## 9. Phasing

| Phase | Scope |
|---|---|
| **v1a** | Admin guard + flag + `/admin` user list (read-only) + `admin_audit` |
| **v1b** | Promote/demote agent, suspend/reactivate, self-action guard |
| **v1c** | `invites` table, waitlist → invite link, retire `SIGNUP_INVITE_CODE` |
| **v2** | Scan-health panel; agent-accounts Phase 2 reuses the `invites` table |

v1a is deliberately read-only so the guard and the audit plumbing are proven
before anything can change state.
