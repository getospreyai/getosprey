// Telegram webhook: replaces the CLI's long-polling `runTelegram`. Vercel
// deploys this route; setWebhook (scripts/set-telegram-webhook.mjs) points
// Telegram at it with a secret_token we verify on every request.

import { NextRequest, NextResponse } from "next/server";
import { hasDb, ensureSchema } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { TelegramClient, handleUpdate, type TgUpdate } from "@/osprey/agent/telegram";
import { OpenRouterIntentParser, llmAvailable } from "@/osprey/agent/messenger/llm";
import type { IntentParser } from "@/osprey/agent/messenger/intents";

// Free OpenRouter endpoints are best-effort and can run slow (30s+ under
// load); the parse + answer round trips need more than the platform default.
export const maxDuration = 60;

/**
 * Telegram's R button/keyword teaser — the AI research-report feature is
 * paused for the MVP relaunch (see src/osprey/reports/generate.ts header);
 * full generate+PDF+deliver flow is preserved in git history.
 */
async function deliverReport(client: TelegramClient, chatId: number): Promise<void> {
  await client.sendMessage(
    chatId,
    "📄 Research reports are coming soon — I'll message you here the moment they're live.",
  );
}

export async function POST(req: NextRequest) {
  const secret = req.headers.get("x-telegram-bot-api-secret-token");
  const expected = process.env.TELEGRAM_WEBHOOK_SECRET;
  if (!expected || secret !== expected) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Always 200 past this point — a non-2xx response makes Telegram retry the
  // same update on a loop, so any downstream failure is caught and logged
  // instead of surfaced as an error status.
  try {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    if (!token) {
      console.error("Telegram webhook: TELEGRAM_BOT_TOKEN is not configured.");
      return NextResponse.json({ ok: true });
    }
    if (!hasDb()) {
      console.error("Telegram webhook: DATABASE_URL is not configured.");
      return NextResponse.json({ ok: true });
    }

    const update = (await req.json().catch(() => null)) as TgUpdate | null;
    if (!update) return NextResponse.json({ ok: true });

    await ensureSchema();
    const store = new PgStore();
    const parser: IntentParser | null = llmAvailable() ? new OpenRouterIntentParser() : null;
    const client = new TelegramClient(token);

    await handleUpdate(update, {
      store,
      parser,
      send: async (chatId, text, opts) => {
        await client.sendMessage(chatId, text, opts);
      },
      answerCallback: (id) => client.answerCallbackQuery(id),
      deliverReport: (chatId) => deliverReport(client, chatId),
      log: (line) => console.log(line),
    });
  } catch (err) {
    console.error("Telegram webhook failed:", err);
  }

  return NextResponse.json({ ok: true });
}
