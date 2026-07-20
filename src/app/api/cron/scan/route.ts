// Daily Vercel cron: pull a fresh RentCast batch, underwrite it against every
// investor's buy box, and deliver verdicts (ledger always; Telegram when the
// investor cleared their alert bar and has a bound chat).

import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { RentCastClient } from "@/osprey/engine";
import { fetchBatch, fetchRentFor } from "@/osprey/agent/watcher";
import { runScan, type VerdictRecord } from "@/osprey/agent/loop";
import { TelegramClient } from "@/osprey/agent/telegram";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  if (!hasDb()) {
    console.error("Cron scan: DATABASE_URL is not configured.");
    return NextResponse.json({ error: "DATABASE_URL is not configured" }, { status: 503 });
  }

  const rentcastKey = process.env.RENTCAST_API_KEY;
  if (!rentcastKey) {
    console.error("Cron scan: RENTCAST_API_KEY is not configured.");
    return NextResponse.json({ error: "RENTCAST_API_KEY is not configured" }, { status: 503 });
  }

  try {
    await ensureSchema();

    const store = new PgStore();
    const rentcast = new RentCastClient({ apiKey: rentcastKey });
    const city = process.env.OSPREY_CITY || "Las Vegas";
    const state = process.env.OSPREY_STATE || "NV";

    const batch = await fetchBatch(rentcast, { city, state, daysOld: 1 });
    const allProfiles = await store.loadAllProfiles();
    // Skip half-configured profiles: onboarded === false is explicitly mid-wizard
    // (undefined covers legacy/CLI profiles predating onboarding, which are
    // considered onboarded); an empty buy box or financing list has nothing
    // to underwrite against.
    const profiles = allProfiles.filter(
      (p) =>
        p.onboarded !== false &&
        p.financingProfiles.length > 0 &&
        p.buyBox.propertyTypes.length > 0
    );
    const profileById = new Map(profiles.map((p) => [p.id, p]));

    // runScan skips ids already in `seen`; markSeen only the ones that were
    // genuinely new to this run, once the scan completes.
    const batchIds = batch.listings.map((l) => l.id);
    const unseenIds = await store.filterUnseen(batchIds);
    const seen = new Set(batchIds.filter((id) => !unseenIds.has(id)));

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const telegram = token ? new TelegramClient(token) : null;

    const summary = await runScan(batch, profiles, seen, {
      getRent: (listing) => fetchRentFor(rentcast, listing),
      deliver: async (record: VerdictRecord) => {
        await store.appendVerdict(record);
        if (!record.wouldText) return;

        const chatId = profileById.get(record.investorId)?.telegramChatId;
        if (chatId == null || !telegram) return;

        try {
          const messageId = await telegram.sendMessage(chatId, record.sms, {
            verdictButtons: true,
          });
          if (messageId != null) await store.saveTgAnchor(chatId, messageId, record.listingId);
        } catch (err) {
          console.error(`telegram send failed (${record.investorId}):`, err);
        }
      },
      log: (line) => console.log(line),
    });

    await store.markSeen([...unseenIds]);

    return NextResponse.json({ ok: true, city, state, ...summary });
  } catch (err) {
    console.error("Cron scan failed:", err);
    return NextResponse.json({ error: "scan failed" }, { status: 500 });
  }
}
