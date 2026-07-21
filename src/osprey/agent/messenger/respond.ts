// The Messenger pipeline: inbound text -> fast-path or LLM parse -> execute ->
// persist -> reply. The Telegram webhook route calls this; any future
// channel (an SMS webhook, say) plugs in the same way.

import type { Store } from "../store";
import type { VerdictRecord } from "../loop";
import { fastPath } from "./fastpath";
import { answerQuestion } from "./llm";
import { executeIntent } from "./actions";
import type { Intent, IntentParser, ParseContext } from "./intents";

export interface RespondDeps {
  store: Store;
  /** LLM parser; null = fast-path only (no credentials available). */
  parser: IntentParser | null;
  /** Grounded Q&A; defaults to the OpenRouter-backed implementation. */
  answer?: (question: string, analysis: string) => Promise<string>;
  log?: (line: string) => void;
}

export interface RespondResult {
  reply: string | null;
  intent: Intent;
  via: "fastpath" | "llm" | "none";
  /** Set when the user asked for a research report; the caller (Telegram
   *  webhook) runs the report service and delivers a PDF out-of-band. */
  reportRequest?: VerdictRecord;
}

export interface RespondOpts {
  /**
   * Listing id the inbound message is anchored to (e.g. a Telegram verdict
   * card's button). Fills intent.deal when the message itself names no deal,
   * so "A" on an old card answers for that card, not the latest arrival.
   */
  dealHint?: string;
}

export async function respond(
  investorId: string,
  message: string,
  deps: RespondDeps,
  opts?: RespondOpts,
): Promise<RespondResult> {
  const profile = await deps.store.loadProfile(investorId);
  if (!profile) throw new Error(`unknown investor: ${investorId}`);
  const recent = await deps.store.loadRecentVerdicts<VerdictRecord>(investorId);
  // Execution sees a deeper window than the parser context, so an anchored
  // reference to an older deal still resolves.
  const history = await deps.store.loadRecentVerdicts<VerdictRecord>(investorId, 100);

  let intent = fastPath(message);
  let via: RespondResult["via"] = intent ? "fastpath" : "none";

  if (!intent) {
    if (!deps.parser) {
      return {
        reply:
          "I can handle A / P / S / HELP without my brain plugged in, but plain English needs OPENROUTER_API_KEY set.",
        intent: { kind: "unknown", clarify: "" },
        via: "none",
      };
    }
    const context: ParseContext = {
      investorName: profile.name,
      buyBoxSummary: summarizeBuyBox(profile),
      recentVerdicts: recent.map((v) => ({
        listingId: v.listingId,
        address: v.address,
        price: v.price,
        monthlyCashFlow: v.monthlyCashFlow,
      })),
    };
    intent = await deps.parser.parse(message, context);
    via = "llm";
  }

  if (opts?.dealHint && "deal" in intent && intent.deal == null) {
    intent = { ...intent, deal: opts.dealHint };
  }

  deps.log?.(`intent(${via}): ${JSON.stringify(intent)}`);
  const result = executeIntent(intent, profile, history);

  if (result.updatedProfile) await deps.store.saveProfile(result.updatedProfile);

  if (result.question) {
    const answerFn = deps.answer ?? answerQuestion;
    const reply = await answerFn(result.question.text, result.question.verdict.analysis);
    return { reply, intent, via };
  }

  return { reply: result.reply, intent, via, reportRequest: result.reportRequest };
}

function summarizeBuyBox(profile: {
  buyBox: {
    states?: string[];
    cities?: string[];
    propertyTypes: string[];
    minPrice?: number;
    maxPrice?: number;
  };
  minMonthlyCashFlow: number;
}): string {
  const b = profile.buyBox;
  return [
    b.propertyTypes.join("/"),
    b.cities?.length ? `in ${b.cities.join(", ")}` : b.states?.length ? `in ${b.states.join(", ")}` : null,
    b.minPrice != null || b.maxPrice != null
      ? `price ${b.minPrice ?? 0}-${b.maxPrice ?? "any"}`
      : null,
    `alert bar $${profile.minMonthlyCashFlow}/mo`,
  ]
    .filter(Boolean)
    .join(" · ");
}
