// The only file in Osprey where an LLM lives. Two jobs, both at the edges:
//  1. parse: English reply -> typed Intent. Shape is triple-enforced: schema
//     spelled out in the prompt (free-pool providers silently drop
//     response_format, verified live 2026-07-20), json_schema response_format
//     for providers that do honor it, and zod validation + one repair retry.
//  2. answerQuestion: grounded answer about a deal, using ONLY numbers from the
//     stored underwriting analysis — the LLM never computes, it quotes.
// Provider: OpenRouter, free models (see ../../llm/openrouter.ts for the
// fetch client). Free-tier caps: 20 req/min always; 50/day until the account
// has ever bought >=$10 credits, then 1000/day — not a code concern beyond
// the 429 handling below.

import { chatComplete, OpenRouterError } from "../../llm/openrouter";
import { IntentSchema, type Intent, type IntentParser, type ParseContext } from "./intents";

const MODEL = process.env.OSPREY_LLM_MODEL || "openai/gpt-oss-20b:free";
// Tried in order after MODEL on error/rate-limit/unavailability. Both, like
// MODEL's default, are among the few free models with strict json_schema support.
const FALLBACK_MODELS = ["nvidia/nemotron-nano-9b-v2:free", "google/gemma-4-26b-a4b-it:free"];

const PARSE_SYSTEM = `You classify inbound SMS replies for Osprey, an agent that texts real-estate investors cash-flow verdicts on new listings.

Resolve deal references against the recent-verdicts list in the message: "the fourplex", "the one on Maryland", "that last one" -> the matching listingId; if the user doesn't name one, use null (meaning the most recent).

Money shorthand is common: "450k" = 450000, "bump my max to 450" in a price context = 450000, "$300/mo" as a cash-flow bar = 300. Rates like "6.5" or "6.5%" = 0.065 as a decimal.

If the message doesn't fit any intent, use kind "unknown" with a short friendly clarifying question. Never invent listing ids not present in the context.

OUTPUT FORMAT — reply with exactly ONE JSON object and nothing else (no prose, no code fences). It must contain ALL of these fields, using null (or [] for the city lists) when a field doesn't apply to the chosen kind:
{
  "kind": one of "full_analysis" | "research_report" | "pass" | "save" | "update_buy_box" | "update_threshold" | "update_financing" | "question" | "pause_alerts" | "resume_alerts" | "help" | "unknown",
  "deal": listingId string from the context, or null for the most recent deal,
  "reason": string or null (pass reason),
  "minPrice": number or null, "maxPrice": number or null,
  "addCities": string[], "removeCities": string[],
  "propertyTypes": array of "single_family"|"duplex"|"triplex"|"fourplex", or null,
  "maxDaysOnMarket": number or null,
  "minMonthlyCashFlow": number or null (new alert bar, update_threshold only),
  "profileLabel": string or null, "rate": number or null, "downPct": number or null,
  "question": string or null (the user's question, question kind only),
  "clarify": string or null (short clarifying question, unknown kind only)
}`;

// Flat mirror of IntentSchema's discriminated union for OpenRouter's
// json_schema structured output (strict mode wants one object, not a
// top-level anyOf, and every property listed in `required`). Fields that only
// apply to some `kind`s are nullable; the model is told via description to
// leave them null otherwise. IntentSchema.safeParse below re-validates, and
// since a plain zod object strips unrecognized/irrelevant keys, only the
// fields belonging to the selected `kind`'s variant are ever actually checked.
const INTENT_JSON_SCHEMA = {
  type: "object",
  properties: {
    kind: {
      type: "string",
      enum: [
        "full_analysis",
        "research_report",
        "pass",
        "save",
        "update_buy_box",
        "update_threshold",
        "update_financing",
        "question",
        "pause_alerts",
        "resume_alerts",
        "help",
        "unknown",
      ],
    },
    deal: {
      type: ["string", "null"],
      description:
        "listingId from the recent verdicts, or null for the most recent deal. Used by full_analysis, research_report, pass, save, question.",
    },
    reason: {
      type: ["string", "null"],
      description: "Why the user passed, if given. Only meaningful when kind=pass.",
    },
    minPrice: { type: ["number", "null"], description: "Only meaningful when kind=update_buy_box." },
    maxPrice: { type: ["number", "null"], description: "Only meaningful when kind=update_buy_box." },
    addCities: {
      type: "array",
      items: { type: "string" },
      description: "Cities to add to the buy box. [] unless kind=update_buy_box.",
    },
    removeCities: {
      type: "array",
      items: { type: "string" },
      description: "Cities to remove from the buy box. [] unless kind=update_buy_box.",
    },
    propertyTypes: {
      type: ["array", "null"],
      items: { type: "string", enum: ["single_family", "duplex", "triplex", "fourplex"] },
      description:
        "Full replacement property-type list, or null to leave unchanged. Only meaningful when kind=update_buy_box.",
    },
    maxDaysOnMarket: { type: ["number", "null"], description: "Only meaningful when kind=update_buy_box." },
    minMonthlyCashFlow: {
      type: ["number", "null"],
      description: "New minimum monthly cash-flow bar in dollars. Required when kind=update_threshold.",
    },
    profileLabel: {
      type: ["string", "null"],
      description:
        "Which financing profile to change, matched loosely by label/kind; null = all. Only meaningful when kind=update_financing.",
    },
    rate: {
      type: ["number", "null"],
      description: "New annual interest rate as a decimal, e.g. 0.065. Only meaningful when kind=update_financing.",
    },
    downPct: {
      type: ["number", "null"],
      description: "New down payment as a decimal, e.g. 0.25. Only meaningful when kind=update_financing.",
    },
    question: {
      type: ["string", "null"],
      description: "The user's question, lightly normalized. Required when kind=question.",
    },
    clarify: {
      type: ["string", "null"],
      description: "A short, friendly clarifying question to send back to the user. Required when kind=unknown.",
    },
  },
  required: [
    "kind",
    "deal",
    "reason",
    "minPrice",
    "maxPrice",
    "addCities",
    "removeCities",
    "propertyTypes",
    "maxDaysOnMarket",
    "minMonthlyCashFlow",
    "profileLabel",
    "rate",
    "downPct",
    "question",
    "clarify",
  ],
  additionalProperties: false,
} as const;

const INTENT_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: { name: "intent", strict: true, schema: INTENT_JSON_SCHEMA },
};

function buildParseUserContent(message: string, context: ParseContext): string {
  return [
    `Investor: ${context.investorName}`,
    `Buy box: ${context.buyBoxSummary}`,
    `Recent verdicts (most recent first):`,
    ...context.recentVerdicts.map(
      (v) =>
        `- listingId=${v.listingId} · ${v.address} · $${v.price.toLocaleString("en-US")} · ${v.monthlyCashFlow >= 0 ? "+" : "-"}$${Math.abs(v.monthlyCashFlow)}/mo`,
    ),
    ``,
    `Inbound SMS: "${message}"`,
  ].join("\n");
}

/** Parse + zod-validate one completion; carries the failure reason so it can
 *  be fed back into the one repair retry. */
function tryValidate(text: string): { ok: true; intent: Intent } | { ok: false; error: string } {
  let candidate: unknown;
  try {
    candidate = JSON.parse(text);
  } catch {
    return { ok: false, error: "response was not valid JSON" };
  }
  const result = IntentSchema.safeParse(candidate);
  if (result.success) return { ok: true, intent: result.data };
  return { ok: false, error: result.error.message };
}

export class OpenRouterIntentParser implements IntentParser {
  async parse(message: string, context: ParseContext): Promise<Intent> {
    const userContent = buildParseUserContent(message, context);
    try {
      // gpt-oss (and the nemotron fallbacks) are reasoning models: hidden
      // reasoning spends max_tokens before any visible content, so a tight
      // budget yields empty/truncated JSON. Free models bill $0 — the
      // headroom is free insurance.
      const first = await chatComplete({
        model: MODEL,
        models: FALLBACK_MODELS,
        system: PARSE_SYSTEM,
        user: userContent,
        maxTokens: 4000,
        responseFormat: INTENT_RESPONSE_FORMAT,
      });
      const firstResult = tryValidate(first.text);
      if (firstResult.ok) return firstResult.intent;

      // One repair retry: feed the validation error back so the model can
      // fix its own output before we give up.
      const second = await chatComplete({
        model: MODEL,
        models: FALLBACK_MODELS,
        system: PARSE_SYSTEM,
        user: `${userContent}\n\nYour previous reply failed validation: ${firstResult.error}\nReply again with corrected JSON only.`,
        maxTokens: 4000,
        responseFormat: INTENT_RESPONSE_FORMAT,
      });
      const secondResult = tryValidate(second.text);
      if (secondResult.ok) return secondResult.intent;

      return { kind: "unknown", clarify: "Sorry — can you rephrase that?" };
    } catch (err) {
      // Any OpenRouter HTTP error (privacy-toggle 404, 429 caps, 502/503
      // free-endpoint flakiness, 402 balance): degrade to a friendly unknown
      // intent — an LLM hiccup must never break the bot; the real cause goes
      // to the logs. Missing key and network errors still propagate (the
      // webhook builds no parser when the key is absent).
      if (err instanceof OpenRouterError) {
        console.error("OpenRouter intent parse failed:", err);
        return {
          kind: "unknown",
          clarify:
            "I'm having trouble thinking right now — the A / P / S / HELP keywords always work, or try again in a minute.",
        };
      }
      throw err;
    }
  }
}

const ANSWER_SYSTEM = `You are Osprey, a real-estate deal agent, answering an investor's question over SMS.

Ground rules:
- Answer ONLY from the underwriting analysis provided. Every number you state must appear in it verbatim. You do no arithmetic — if the answer would require computing a number not present, say you'll run it and flag the limitation instead of estimating.
- SMS length: 1-3 short sentences, no markdown, no greetings.
- If the analysis doesn't contain the answer, say so plainly.`;

export async function answerQuestion(question: string, analysisText: string): Promise<string> {
  try {
    const result = await chatComplete({
      model: MODEL,
      models: FALLBACK_MODELS,
      system: ANSWER_SYSTEM,
      user: `Underwriting analysis:\n${analysisText}\n\nQuestion: ${question}`,
      // Reasoning models spend budget on hidden reasoning first; the SMS-length
      // cap lives in the system prompt, not in max_tokens.
      maxTokens: 1500,
    });
    return result.text.trim() || "I couldn't answer that one — try the dashboard for the full workup.";
  } catch (err) {
    // Free-pool endpoints abort mid-flight routinely; a Q&A hiccup must reply,
    // not 500 the webhook. Real cause goes to the logs.
    if (err instanceof OpenRouterError) {
      console.error("OpenRouter answerQuestion failed:", err);
      return "I couldn't pull that up just now — give it another try in a minute, or open the dashboard for the full workup.";
    }
    throw err;
  }
}

/** True when an OpenRouter credential is plausibly available. */
export function llmAvailable(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}
