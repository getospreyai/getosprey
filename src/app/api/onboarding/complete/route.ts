// Onboarding wizard's final step: save the buy box / financing / alert bar
// the user just set (same shape + validation as /api/profile PATCH), mark
// the profile onboarded, and — inline, best-effort — run their first scan
// against the current Las Vegas market. Mirrors the delivery logic in
// /api/cron/scan, but scoped to this one investor and NOT touching
// seen_listings: that table is global cron state, and a per-user initial
// scan must not cause the next daily cron to skip listings this user has
// already "seen" via onboarding.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { ensureSchema, hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { PatchProfileSchema, mergeProfileSettings } from "@/lib/profile-schema";
import { RentCastClient } from "@/osprey/engine";
import { fetchBatch, fetchRentFor } from "@/osprey/agent/watcher";
import { runScan, type VerdictRecord } from "@/osprey/agent/loop";
import { TelegramClient } from "@/osprey/agent/telegram";

export const maxDuration = 60;

/** RentCast's minimum useful batch for a fresh market scan; fetchBatch has
 *  no limit param, so we slice the fetched batch down to this many. */
const INITIAL_SCAN_LIMIT = 30;

export async function POST(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!hasDb()) {
    return NextResponse.json(
      { error: "Onboarding is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some of those settings don't look right." },
      { status: 400 }
    );
  }

  try {
    await ensureSchema();
  } catch (err) {
    console.error("Onboarding complete: ensureSchema failed:", err);
    return NextResponse.json(
      { error: "Onboarding is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  const store = new PgStore();
  const stored = await store.loadProfile(userId);
  if (!stored) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }
  if (stored.initialScanAt) {
    return NextResponse.json({ error: "already onboarded" }, { status: 409 });
  }

  const profile = {
    ...mergeProfileSettings(stored, parsed.data),
    onboarded: true,
    initialScanAt: new Date().toISOString(),
  };
  await store.saveProfile(profile);

  const rentcastKey = process.env.RENTCAST_API_KEY;
  if (!rentcastKey) {
    console.error("Onboarding complete: RENTCAST_API_KEY is not configured; skipping initial scan.");
    return NextResponse.json({ ok: true, scan: null });
  }

  try {
    const rentcast = new RentCastClient({ apiKey: rentcastKey });
    const city = process.env.OSPREY_CITY || "Las Vegas";
    const state = process.env.OSPREY_STATE || "NV";

    const batch = await fetchBatch(rentcast, { city, state, daysOld: 7 });
    const listings = batch.listings.slice(0, INITIAL_SCAN_LIMIT);

    const token = process.env.TELEGRAM_BOT_TOKEN;
    const telegram = token ? new TelegramClient(token) : null;

    const summary = await runScan(
      { listings, rentEstimates: batch.rentEstimates },
      [profile],
      new Set(), // per-user initial scan: never consults or updates the global seen_listings table
      {
        getRent: (listing) => fetchRentFor(rentcast, listing),
        deliver: async (record: VerdictRecord) => {
          await store.appendVerdict(record);
          if (!record.wouldText) return;

          const chatId = profile.telegramChatId;
          if (chatId == null || !telegram) return;

          try {
            const messageId = await telegram.sendMessage(chatId, record.sms, {
              verdictButtons: true,
            });
            if (messageId != null) await store.saveTgAnchor(chatId, messageId, record.listingId);
          } catch (err) {
            console.error(`Onboarding scan: telegram send failed (${userId}):`, err);
          }
        },
      }
    );

    return NextResponse.json({ ok: true, scan: summary });
  } catch (err) {
    console.error("Onboarding complete: initial scan failed:", err);
    return NextResponse.json({ ok: true, scan: null });
  }
}
