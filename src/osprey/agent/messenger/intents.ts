// The Messenger's typed vocabulary: every inbound SMS resolves to exactly one
// of these intents. The LLM's only job is translating English into this union
// (via structured outputs, so the shape is guaranteed); everything downstream
// is deterministic code.

import { z } from "zod";

// Listing reference: a listingId from the recent-verdicts context, or null
// meaning "the most recent one I was texted".
const dealRef = z
  .string()
  .nullable()
  .describe(
    "listingId of the deal being referenced, chosen from the recent verdicts provided in context; null if the user means the most recent deal",
  );

export const IntentSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("full_analysis"),
    deal: dealRef,
  }),
  z.object({
    kind: z.literal("pass"),
    deal: dealRef,
    reason: z
      .string()
      .nullable()
      .describe("why the user passed, verbatim-ish, if they gave a reason"),
  }),
  z.object({
    kind: z.literal("save"),
    deal: dealRef,
  }),
  z.object({
    kind: z.literal("update_buy_box"),
    minPrice: z.number().nullable(),
    maxPrice: z.number().nullable(),
    addCities: z.array(z.string()).describe("cities to add to the buy box; empty if none"),
    removeCities: z.array(z.string()).describe("cities to remove; empty if none"),
    propertyTypes: z
      .array(z.enum(["single_family", "duplex", "triplex", "fourplex"]))
      .nullable()
      .describe("full replacement list of property types, or null to leave unchanged"),
    maxDaysOnMarket: z.number().nullable(),
  }),
  z.object({
    kind: z.literal("update_threshold"),
    minMonthlyCashFlow: z
      .number()
      .describe("new minimum monthly cash flow in dollars required to trigger a text"),
  }),
  z.object({
    kind: z.literal("update_financing"),
    profileLabel: z
      .string()
      .nullable()
      .describe("which financing profile to change, matched loosely by label/kind; null = all"),
    rate: z.number().nullable().describe("new annual interest rate as a decimal, e.g. 0.065"),
    downPct: z.number().nullable().describe("new down payment as a decimal, e.g. 0.25"),
  }),
  z.object({
    kind: z.literal("question"),
    deal: dealRef,
    question: z.string().describe("the user's question, lightly normalized"),
  }),
  z.object({ kind: z.literal("pause_alerts") }),
  z.object({ kind: z.literal("resume_alerts") }),
  z.object({ kind: z.literal("help") }),
  z.object({
    kind: z.literal("unknown"),
    clarify: z
      .string()
      .describe("a short, friendly clarifying question to send back to the user"),
  }),
]);

export type Intent = z.infer<typeof IntentSchema>;

/** Context the parser needs to resolve references like "the one on Maryland". */
export interface ParseContext {
  investorName: string;
  buyBoxSummary: string;
  /** Most recent first. */
  recentVerdicts: Array<{
    listingId: string;
    address: string;
    price: number;
    monthlyCashFlow: number;
  }>;
}

export interface IntentParser {
  parse(message: string, context: ParseContext): Promise<Intent>;
}
