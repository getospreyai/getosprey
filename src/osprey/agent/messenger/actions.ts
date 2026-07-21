// Deterministic intent executor: applies a typed Intent to the investor
// profile and thread state, returns the SMS reply. No LLM here — replies are
// templates, mutations are code. (The one exception, grounded Q&A, is
// delegated back to the caller via the `question` result.)

import type { InvestorProfile } from "../model";
import type { VerdictRecord } from "../loop";
import type { Intent } from "./intents";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export interface ActionResult {
  /** SMS reply to send; null = send nothing (e.g. after STOP). */
  reply: string | null;
  /** Present when the profile changed and must be persisted. */
  updatedProfile?: InvestorProfile;
  /** Present when the intent is a question the caller should answer via LLM. */
  question?: { text: string; verdict: VerdictRecord };
  /** Present when the user asked for a research report; the caller runs the
   *  (rate-limited, cached) report service and delivers the PDF out-of-band. */
  reportRequest?: VerdictRecord;
}

/** Resolve a deal reference to a verdict record (null ref = most recent). */
function resolveDeal(
  ref: string | null,
  recent: VerdictRecord[],
): VerdictRecord | undefined {
  if (ref == null) return recent[0];
  return recent.find((v) => v.listingId === ref) ?? recent[0];
}

export function executeIntent(
  intent: Intent,
  profile: InvestorProfile,
  recentVerdicts: VerdictRecord[],
): ActionResult {
  switch (intent.kind) {
    case "full_analysis": {
      const deal = resolveDeal(intent.deal, recentVerdicts);
      if (!deal) return { reply: "No deals in your thread yet — I'll text you when one clears your bar." };
      return { reply: deal.analysis };
    }

    case "research_report": {
      // Deterministic here: resolve the deal and hand it back. The caller
      // (Telegram webhook) runs the report service and delivers the PDF.
      const deal = resolveDeal(intent.deal, recentVerdicts);
      if (!deal) return { reply: "No deals in your thread yet to report on — I'll text you when one clears your bar." };
      return { reply: null, reportRequest: deal };
    }

    case "pass": {
      const deal = resolveDeal(intent.deal, recentVerdicts);
      const updated: InvestorProfile = intent.reason
        ? {
            ...profile,
            tasteNotes: [
              ...(profile.tasteNotes ?? []),
              deal ? `Passed on ${deal.address}: ${intent.reason}` : `Pass note: ${intent.reason}`,
            ],
          }
        : profile;
      const ack = deal ? `Passed on ${deal.address}.` : "Passed.";
      return {
        reply: intent.reason ? `${ack} Noted — I'll factor that into what I send you next.` : ack,
        updatedProfile: intent.reason ? updated : undefined,
      };
    }

    case "save": {
      const deal = resolveDeal(intent.deal, recentVerdicts);
      if (!deal) return { reply: "Nothing to save yet." };
      return { reply: `Saved ${deal.address}. It's on your dashboard.` };
    }

    case "update_buy_box": {
      const box = { ...profile.buyBox };
      const changes: string[] = [];
      if (intent.minPrice != null) {
        box.minPrice = intent.minPrice;
        changes.push(`min price ${money(intent.minPrice)}`);
      }
      if (intent.maxPrice != null) {
        box.maxPrice = intent.maxPrice;
        changes.push(`max price ${money(intent.maxPrice)}`);
      }
      if (intent.addCities.length) {
        const existing = new Set((box.cities ?? []).map((c) => c.toLowerCase()));
        box.cities = [...(box.cities ?? []), ...intent.addCities.filter((c) => !existing.has(c.toLowerCase()))];
        changes.push(`watching ${intent.addCities.join(", ")}`);
      }
      if (intent.removeCities.length) {
        const drop = new Set(intent.removeCities.map((c) => c.toLowerCase()));
        box.cities = (box.cities ?? []).filter((c) => !drop.has(c.toLowerCase()));
        changes.push(`dropped ${intent.removeCities.join(", ")}`);
      }
      if (intent.propertyTypes != null) {
        box.propertyTypes = intent.propertyTypes;
        changes.push(`types: ${intent.propertyTypes.join(", ")}`);
      }
      if (intent.maxDaysOnMarket != null) {
        box.maxDaysOnMarket = intent.maxDaysOnMarket;
        changes.push(`max ${intent.maxDaysOnMarket} days on market`);
      }
      if (!changes.length) return { reply: "Nothing to change — your buy box is as it was." };
      return {
        reply: `Updated: ${changes.join(" · ")}. New matches will use this.`,
        updatedProfile: { ...profile, buyBox: box },
      };
    }

    case "update_threshold": {
      return {
        reply: `Got it — I'll only text deals cash flowing ${money(intent.minMonthlyCashFlow)}/mo or better. Everything else goes to your dashboard quietly.`,
        updatedProfile: { ...profile, minMonthlyCashFlow: intent.minMonthlyCashFlow },
      };
    }

    case "update_financing": {
      const label = intent.profileLabel?.toLowerCase();
      let touched = 0;
      const financingProfiles = profile.financingProfiles.map((fp) => {
        const fpLabel = ("label" in fp && fp.label ? fp.label : fp.kind).toLowerCase();
        if (label && !fpLabel.includes(label)) return fp;
        touched++;
        const next = { ...fp } as typeof fp & { rate?: number; downPct?: number };
        if (intent.rate != null && "rate" in next) next.rate = intent.rate;
        if (intent.downPct != null && "downPct" in next) next.downPct = intent.downPct;
        return next;
      });
      if (!touched) return { reply: "I couldn't match that financing profile — reply HELP to see what I know." };
      const bits = [
        intent.rate != null ? `rate ${(intent.rate * 100).toFixed(2)}%` : null,
        intent.downPct != null ? `${Math.round(intent.downPct * 100)}% down` : null,
      ].filter(Boolean);
      return {
        reply: `Updated ${touched} financing profile(s): ${bits.join(", ")}. Future verdicts run at your new numbers.`,
        updatedProfile: { ...profile, financingProfiles },
      };
    }

    case "question": {
      const deal = resolveDeal(intent.deal, recentVerdicts);
      if (!deal) return { reply: "No deals in your thread yet to ask about." };
      return { reply: null, question: { text: intent.question, verdict: deal } };
    }

    case "pause_alerts": {
      // On Telegram no carrier backstops STOP — pausing and going silent is on us.
      return { reply: null, updatedProfile: { ...profile, alertsPaused: true } };
    }

    case "resume_alerts": {
      return {
        reply: "You're back on. I'll message you when a deal clears your bar.",
        updatedProfile: { ...profile, alertsPaused: false },
      };
    }

    case "help": {
      return {
        reply:
          `I text you underwritten deals that clear your cash-flow bar (currently ${money(profile.minMonthlyCashFlow)}/mo).\n` +
          `Reply A for the full breakdown, P to pass (add a reason and I learn), S to save, R for a client-ready research report (PDF).\n` +
          `Or just tell me things: "bump my max to 450k" · "only text me $300/mo+" · "what are the taxes on that one"`,
      };
    }

    case "unknown": {
      return { reply: intent.clarify };
    }
  }
}
