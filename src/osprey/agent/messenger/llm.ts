// The only file in Osprey where an LLM lives. Two jobs, both at the edges:
//  1. parse: English reply -> typed Intent (structured outputs guarantee shape)
//  2. answerQuestion: grounded answer about a deal, using ONLY numbers from the
//     stored underwriting analysis — the LLM never computes, it quotes.

import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { IntentSchema, type Intent, type IntentParser, type ParseContext } from "./intents";

const MODEL = process.env.OSPREY_LLM_MODEL || "claude-opus-4-8";

const PARSE_SYSTEM = `You classify inbound SMS replies for Osprey, an agent that texts real-estate investors cash-flow verdicts on new listings.

Resolve deal references against the recent-verdicts list in the message: "the fourplex", "the one on Maryland", "that last one" -> the matching listingId; if the user doesn't name one, use null (meaning the most recent).

Money shorthand is common: "450k" = 450000, "bump my max to 450" in a price context = 450000, "$300/mo" as a cash-flow bar = 300. Rates like "6.5" or "6.5%" = 0.065 as a decimal.

If the message doesn't fit any intent, use kind "unknown" with a short friendly clarifying question. Never invent listing ids not present in the context.`;

export class AnthropicIntentParser implements IntentParser {
  private client: Anthropic;

  constructor(client?: Anthropic) {
    this.client = client ?? new Anthropic();
  }

  async parse(message: string, context: ParseContext): Promise<Intent> {
    const response = await this.client.messages.parse({
      model: MODEL,
      max_tokens: 1000,
      system: PARSE_SYSTEM,
      output_config: { format: zodOutputFormat(IntentSchema) },
      messages: [
        {
          role: "user",
          content: [
            `Investor: ${context.investorName}`,
            `Buy box: ${context.buyBoxSummary}`,
            `Recent verdicts (most recent first):`,
            ...context.recentVerdicts.map(
              (v) =>
                `- listingId=${v.listingId} · ${v.address} · $${v.price.toLocaleString("en-US")} · ${v.monthlyCashFlow >= 0 ? "+" : "-"}$${Math.abs(v.monthlyCashFlow)}/mo`,
            ),
            ``,
            `Inbound SMS: "${message}"`,
          ].join("\n"),
        },
      ],
    });
    return response.parsed_output ?? { kind: "unknown", clarify: "Sorry — can you rephrase that?" };
  }
}

const ANSWER_SYSTEM = `You are Osprey, a real-estate deal agent, answering an investor's question over SMS.

Ground rules:
- Answer ONLY from the underwriting analysis provided. Every number you state must appear in it verbatim. You do no arithmetic — if the answer would require computing a number not present, say you'll run it and flag the limitation instead of estimating.
- SMS length: 1-3 short sentences, no markdown, no greetings.
- If the analysis doesn't contain the answer, say so plainly.`;

export async function answerQuestion(
  question: string,
  analysisText: string,
  client?: Anthropic,
): Promise<string> {
  const anthropic = client ?? new Anthropic();
  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 300,
    system: ANSWER_SYSTEM,
    messages: [
      {
        role: "user",
        content: `Underwriting analysis:\n${analysisText}\n\nQuestion: ${question}`,
      },
    ],
  });
  const block = response.content.find((b) => b.type === "text");
  return block?.text.trim() ?? "I couldn't answer that one — try the dashboard for the full workup.";
}

/** True when some Anthropic credential is plausibly available. */
export function llmAvailable(): boolean {
  return Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
}
