// Daily Vercel cron: pull a fresh RentCast batch, underwrite it against every
// investor's buy box, and deliver verdicts (ledger always; Telegram when the
// investor cleared their alert bar and has a bound chat). Also re-underwrites
// already-known listings whose price moved (see onSeenListing below) and
// records this run's tallies for the Sunday digest.

import { NextRequest, NextResponse } from "next/server";
import { ensureSchema, hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import {
  RentCastClient,
  buildPriceCutAlert,
  buildVerdict,
  isRepeatPriceCut,
  solveMaxOffer,
  toIncomeInput,
  toPropertyInput,
  underwrite,
  type RentCastListing,
  type Underwriting,
} from "@/osprey/engine";
import { fetchBatch, fetchRentFor } from "@/osprey/agent/watcher";
import { runScan, type VerdictRecord } from "@/osprey/agent/loop";
import { matchesBuyBox } from "@/osprey/agent/matcher";
import { TelegramClient } from "@/osprey/agent/telegram";
import { buildWeeklyDigest } from "@/osprey/agent/digest";

export const maxDuration = 60;

export async function GET(req: NextRequest) {
  const auth = req.headers.get("authorization");
  const expected = process.env.CRON_SECRET;
  if (!expected || auth !== `Bearer ${expected}`) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Opt-in gate: unset disables scans with zero dashboard work; flipping
  // this one Vercel var re-enables. A deliberately paused scan is not a
  // failing cron, so it's a 200.
  if (process.env.RENTCAST_ENABLED !== "true") {
    return NextResponse.json({ ok: true, skipped: "rentcast_disabled" });
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

    // Full active-set pull (no daysOld): one daily paginated fetch serves
    // both the new-listing pipeline (unseen ids, below) and the price-cut
    // pipeline (seen ids, onSeenListing) — daysOld alone would miss price
    // cuts on listings older than the window. See wave2-research.md
    // RECOMMENDATIONS §1.
    const batch = await fetchBatch(rentcast, { city, state });
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

    let priceChanges = 0;

    // Price-cut re-underwrite: fires for listings already in `seen` instead
    // of full new-listing processing. Reuses the stored rent (no AVM
    // re-fetch — that's the whole cost point of this path), and only alerts
    // when a profile's verdict actually crosses the clearing bar; a quiet
    // ledger row still lands when the classification flips the other way
    // (was clearing, isn't anymore), and nothing is written when the
    // pass/fail class is unchanged.
    const onSeenListing = async (listing: RentCastListing) => {
      const snapshot = await store.loadSnapshot(listing.id);
      if (!snapshot || !snapshot.rent) return; // never snapshotted, or no rent to reuse
      const storedRent = snapshot.rent;

      const result = await store.saveSnapshot(listing.id, listing, storedRent);
      if (!result) return; // price unchanged
      priceChanges++;
      const { oldPrice, newPrice } = result.priceChange;

      const oldProperty = toPropertyInput(snapshot.listing);
      const newProperty = toPropertyInput(listing);
      const income = toIncomeInput(storedRent);
      if (!oldProperty || !newProperty || !income) return; // fell out of niche

      const interested = profiles.filter((p) => matchesBuyBox(listing, p.buyBox, p.dealbreakers));
      const repeatCut = isRepeatPriceCut(listing);
      const address = [listing.addressLine1, listing.city].filter(Boolean).join(", ");

      for (const investor of interested) {
        let bestOld: Underwriting | null = null;
        let bestNew: Underwriting | null = null;
        for (const financing of investor.financingProfiles) {
          const oldUw = underwrite({
            property: oldProperty,
            income,
            financing,
            assumptions: investor.assumptions,
          });
          const newUw = underwrite({
            property: newProperty,
            income,
            financing,
            assumptions: investor.assumptions,
          });
          if (!bestOld || oldUw.monthlyCashFlow > bestOld.monthlyCashFlow) bestOld = oldUw;
          if (!bestNew || newUw.monthlyCashFlow > bestNew.monthlyCashFlow) bestNew = newUw;
        }
        if (!bestOld || !bestNew) continue;

        const wasClearing = buildVerdict(bestOld, {
          minMonthlyCashFlow: investor.minMonthlyCashFlow,
        }).meetsThreshold;
        const newVerdict = buildVerdict(bestNew, {
          minMonthlyCashFlow: investor.minMonthlyCashFlow,
          daysOnMarket: listing.daysOnMarket,
        });

        // Only log when the pass/fail classification actually changed —
        // trivial cash-flow wiggles that don't cross the bar stay silent.
        if (wasClearing === newVerdict.meetsThreshold) continue;
        const flipsToClear = !wasClearing && newVerdict.meetsThreshold;

        const maxOffer = solveMaxOffer({
          property: newProperty,
          income,
          financing: bestNew.financing,
          assumptions: investor.assumptions,
          targetMonthlyCashFlow: investor.minMonthlyCashFlow,
        });

        const record: VerdictRecord = {
          at: new Date().toISOString(),
          investorId: investor.id,
          listingId: listing.id,
          address,
          price: newPrice,
          financingLabel: bestNew.loan.label,
          monthlyCashFlow: Math.round(bestNew.monthlyCashFlow),
          qualifies: bestNew.qualification.pass,
          wouldText: flipsToClear && investor.alertsPaused !== true,
          sms: flipsToClear
            ? buildPriceCutAlert(bestNew, {
                address,
                oldPrice,
                daysOnMarket: listing.daysOnMarket,
                repeatCut,
                maxOffer,
              })
            : newVerdict.sms,
          analysis: newVerdict.analysis,
          capRatePct: bestNew.metrics.capRatePct,
          maxOffer: maxOffer
            ? { maxPrice: maxOffer.maxPrice, pctVsAsk: maxOffer.pctVsAsk, clearsAtAsk: maxOffer.clearsAtAsk }
            : undefined,
        };

        await store.appendVerdict(record);
        if (!record.wouldText) continue;

        const chatId = investor.telegramChatId;
        if (chatId == null || !telegram) continue;

        try {
          const messageId = await telegram.sendMessage(chatId, record.sms, {
            verdictButtons: true,
          });
          if (messageId != null) await store.saveTgAnchor(chatId, messageId, record.listingId);
        } catch (err) {
          console.error(`price-cut telegram send failed (${investor.id}):`, err);
        }
      }
    };

    const summary = await runScan(batch, profiles, seen, {
      getRent: (listing) => fetchRentFor(rentcast, listing),
      persistSnapshot: (listing, rent) => store.saveSnapshot(listing.id, listing, rent),
      onSeenListing,
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
    await store.recordScanRun({ city, state, ...summary, priceChanges });

    // Sunday digest: deterministic text, no LLM (digest.ts). Only attempted
    // on Sunday in the product's home timezone, and only for investors with
    // a bound chat, unpaused alerts, and a stale (>6d old, or never-sent)
    // lastDigestAt — so a mid-week redeploy or extra cron run can't double-send.
    let digestsSent = 0;
    const laWeekday = new Date().toLocaleString("en-US", {
      timeZone: "America/Los_Angeles",
      weekday: "long",
    });
    if (laWeekday === "Sunday") {
      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
      const scanTotals = await store.loadScanRunTotalsSince(sevenDaysAgo);

      // scan_runs has no rows this week (e.g. RENTCAST_ENABLED was off until
      // today) — a paused product must stay silent, not report zeros.
      if (scanTotals.runCount > 0) {
        const SIX_DAYS_MS = 6 * 24 * 60 * 60 * 1000;
        const isStale = (iso?: string) => !iso || Date.now() - new Date(iso).getTime() > SIX_DAYS_MS;

        for (const investor of profiles) {
          const chatId = investor.telegramChatId;
          if (chatId == null || !telegram) continue;
          if (investor.alertsPaused === true) continue;
          if (!isStale(investor.lastDigestAt)) continue;

          try {
            const verdicts = await store.loadVerdictsSince(investor.id, sevenDaysAgo);
            const text = buildWeeklyDigest({ bar: investor.minMonthlyCashFlow, scanTotals, verdicts });
            if (!text) continue;

            await telegram.sendMessage(chatId, text);
            // Settings-style write: never touches telegram_chat_id.
            await store.saveProfileSettings({ ...investor, lastDigestAt: new Date().toISOString() });
            digestsSent++;
          } catch (err) {
            console.error(`weekly digest failed (${investor.id}):`, err);
          }
        }
      }
    }

    return NextResponse.json({ ok: true, city, state, ...summary, priceChanges, digestsSent });
  } catch (err) {
    console.error("Cron scan failed:", err);
    return NextResponse.json({ error: "scan failed" }, { status: 500 });
  }
}
