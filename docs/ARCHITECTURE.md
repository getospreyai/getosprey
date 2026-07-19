# Osprey SaaS architecture (v1 — 2026-07-19)

Decisions made at the MVP pivot from single-user CLI to hosted multi-tenant SaaS.

## The shape

One Next.js app (this repo) on Vercel + Neon Postgres is the entire product:
landing page, auth, dashboard, and the agent runtime (serverless).

```
Telegram user ──▶ Bot webhook  /api/telegram   ──▶ respond() ──▶ sendMessage
Vercel cron  ──▶ Scan route   /api/cron/scan  ──▶ runScan() ──▶ verdicts → Telegram + ledger
Browser      ──▶ Auth pages + /dashboard + /settings (Neon-backed)
```

## Key decisions & why

- **One Telegram bot for all users.** Bots are multi-tenant: each user has a
  private chat with a unique `chat_id`; routing/delivery key off
  `investor_profiles.telegram_chat_id`. A user's "own agent" is their profile
  row (buy box, financing, bar, taste notes) — logical isolation, not
  per-user processes.
- **Webhook, not long-polling, in production.** No always-on process to host.
  `setWebhook` points at `/api/telegram` with a `secret_token` we verify.
  Long-polling (`npm run telegram` in ../osprey-agent) remains the local dev mode.
- **Daily Vercel cron for scans.** Hobby tier allows daily cron — and the
  Jul 18 lag probe showed RentCast sale listings are a ~daily batch feed, so
  higher frequency buys nothing until an MLS feed lands. Route protected by
  `CRON_SECRET`.
- **Auth.js v5 credentials** (email + bcrypt, JWT sessions): self-contained,
  zero external vendor; upgrade path to OAuth later. Signup creates the user
  and a default investor profile.
- **Engine + agent core vendored into `src/osprey/`.** Vercel deploys this
  repo only; `file:` deps on sibling repos can't deploy. `../osprey-engine`
  and `../osprey-agent` are now the dev harness; this repo is canonical for
  product code.
- **`PgStore` implements the `FileStore` interface** so `respond()`/`runScan()`
  are unchanged. Tables mirror what `osprey-agent/db/schema.sql` anticipated:
  `users`, `investor_profiles` (jsonb profile + telegram_chat_id),
  `verdicts`, `seen_listings`, `tg_anchors`.
- **Telegram binding = per-user deep link.** The connect card shows
  `t.me/OspreyAlphaBot?start=<userId>`; `/start <userId>` binds that chat to
  the user's profile (rebind-protected, same rules as the CLI version).

## Env (Vercel project settings + .env.local)

```
DATABASE_URL            (exists — Neon)
AUTH_SECRET             (new — Auth.js)
TELEGRAM_BOT_TOKEN      (same bot as dev: @OspreyAlphaBot)
TELEGRAM_WEBHOOK_SECRET (new — verified on /api/telegram)
CRON_SECRET             (new — verified on /api/cron/scan)
RENTCAST_API_KEY
ANTHROPIC_API_KEY       (optional; keyword-only without it)
```

## Deliberately punted (post-MVP)

Payments/pricing tiers · email verification + password reset · OAuth ·
per-metro scan config UI · SMS channel (Twilio, behind same seams) ·
admin panel · rate limiting beyond Vercel defaults.
