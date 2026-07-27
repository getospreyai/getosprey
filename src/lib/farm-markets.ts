// Farm markets: the agent's declared coverage area, and the rule that every
// client buy box must fall inside it.
//
// This is the cost control for the whole feature. The daily cron derives one
// scan target per distinct market across ALL profiles and each target is a full
// paginated RentCast pull (~12-20 calls), capped by OSPREY_MAX_MARKETS. Without
// this constraint one agent with fifty clients in fifty metros would blow past
// the cap, and capMarkets would silently drop the overflow — leaving those
// clients scanned by nobody. Validating at WRITE time means the agent gets a
// clear error while they are looking at the form, instead of a client quietly
// never hearing from Osprey.
//
// It also matches how agents actually work: a realtor farms a defined area.

import type { BuyBox } from "@/osprey/agent/model";
import { deriveMarkets, marketLabel, type WatchTarget } from "@/osprey/agent/watcher";

/**
 * Does `farm` cover `target`?
 *
 * A whole-state farm market covers every city in that state. A city-specific
 * farm market covers only that city — notably it does NOT cover a whole-state
 * target, since scanning "all of NV" is strictly more work than the agent
 * declared.
 */
export function farmCovers(farm: WatchTarget[], target: WatchTarget): boolean {
  return farm.some((f) => {
    if (f.state.toUpperCase() !== target.state.toUpperCase()) return false;
    if (!f.city) return true; // whole-state farm covers anything in it
    if (!target.city) return false; // city farm cannot cover a whole state
    return f.city.toLowerCase() === target.city.toLowerCase();
  });
}

export type FarmCheck =
  | { ok: true }
  | { ok: false; uncovered: WatchTarget[]; reason: string };

/**
 * Whether every market this buy box would scan is inside the agent's farm.
 *
 * An empty farm rejects everything: an agent must declare where they work
 * before adding clients, otherwise the cost control does not exist. A buy box
 * that derives no markets at all (no state set) is also rejected — it cannot be
 * scanned, and silently accepting it recreates the invisible-failure problem
 * this function exists to prevent.
 */
export function withinFarm(buyBox: BuyBox, farm: WatchTarget[]): FarmCheck {
  const targets = deriveMarkets([{ buyBox }]);

  if (targets.length === 0) {
    return {
      ok: false,
      uncovered: [],
      reason: "Pick a state for this client — Osprey can’t scan without one.",
    };
  }
  if (farm.length === 0) {
    return {
      ok: false,
      uncovered: targets,
      reason: "Set your farm markets in Settings before adding clients.",
    };
  }

  const uncovered = targets.filter((t) => !farmCovers(farm, t));
  if (uncovered.length === 0) return { ok: true };

  return {
    ok: false,
    uncovered,
    reason:
      `Outside your farm markets: ${uncovered.map(marketLabel).join("; ")}. ` +
      `You cover ${farm.map(marketLabel).join("; ")}.`,
  };
}

/** Parse stored/submitted farm markets, dropping anything malformed. States
 *  are normalized upper-case and a blank city means "whole state". */
export function parseFarmMarkets(raw: unknown): WatchTarget[] {
  if (!Array.isArray(raw)) return [];
  const out: WatchTarget[] = [];
  const seen = new Set<string>();
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const { city, state } = entry as { city?: unknown; state?: unknown };
    if (typeof state !== "string" || state.trim().length === 0) continue;
    const normState = state.trim().toUpperCase();
    const normCity = typeof city === "string" && city.trim() ? city.trim() : undefined;
    const key = `${normCity?.toLowerCase() ?? ""}|${normState}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(normCity ? { city: normCity, state: normState } : { state: normState });
  }
  return out;
}
