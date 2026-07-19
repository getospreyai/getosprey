// Points the Telegram bot's webhook at this app's /api/telegram route.
// Run once per deploy target (or whenever APP_URL/the secret changes):
//   npm run webhook:set
//
// Reads TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, APP_URL from the
// environment — export them or prefix the command, e.g.:
//   TELEGRAM_BOT_TOKEN=... TELEGRAM_WEBHOOK_SECRET=... APP_URL=https://getosprey.ai npm run webhook:set

const token = process.env.TELEGRAM_BOT_TOKEN;
const secret = process.env.TELEGRAM_WEBHOOK_SECRET;
const appUrl = process.env.APP_URL;

if (!token || !secret || !appUrl) {
  console.error(
    "Missing required env vars. Need TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, and APP_URL.",
  );
  process.exit(1);
}

const webhookUrl = `${appUrl.replace(/\/$/, "")}/api/telegram`;

const res = await fetch(`https://api.telegram.org/bot${token}/setWebhook`, {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({
    url: webhookUrl,
    secret_token: secret,
    allowed_updates: ["message", "callback_query"],
  }),
});

const body = await res.json();
console.log(`setWebhook -> ${webhookUrl}`);
console.log(JSON.stringify(body, null, 2));

if (!body.ok) {
  process.exit(1);
}
