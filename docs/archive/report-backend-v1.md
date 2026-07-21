# Archived: AI research report backend v1 (Anthropic, 2026-07-19)

The report feature shipped fully working (Claude Sonnet + server-side web search,
structured JSON, PDF via Telegram) and was then reduced to a coming-soon teaser in
the OpenRouter free-model MVP migration — the working tree was edited in place, so
this backend never landed in git history on its own. This file preserves what's
needed to re-enable it without a rebuild.

Still in the tree (untouched by the teardown): `ReportSchema`/`PropertyReport` in
`src/osprey/reports/generate.ts` · the PDF renderer `src/osprey/reports/pdf.ts` +
`GET /api/property/[listingId]/report/pdf` · PgStore report methods
(`getReport/upsertReportGenerating/saveReportReady/markReportFailed/countReportsSince`)
· the `property_reports` table · `research_report` intent + `R` fast-path/button ·
report rendering blocks on the property + share pages.

Removed (restore from below): `generatePropertyReport` in `generate.ts` · the real
`POST /api/property/[listingId]/report` handler · `ReportPanel`'s generate/poll UI ·
the webhook's `deliverReport` generation flow.

## Wiring contracts (what the removed pieces did)

**POST /api/property/[listingId]/report** (auth'd, `Cache-Control: no-store`,
`maxDuration = 300`): body `{ force?: boolean }` → 200 `{ status:"ready", report,
model, cached? }`. Flow: cache/dedup check BEFORE rate limit (a cached hit never
burns budget) → errors 401 · 403 `forbidden` (no verdict for user+listing) · 404
`no_snapshot` · 422 `not_underwritable`/`no_rent` · 409 `in_progress` (a
'generating' row < 5 min old — this collapses Telegram webhook retries) · 429
`rate_limited` (`countReportsSince` ≥ 10 per user per 24h, counted on `updated_at`)
· 503 `reports_unavailable` (no API key, checked before claiming a generating slot)
· 502 `generation_failed` (after `markReportFailed`). Success path:
`upsertReportGenerating` → generate → `saveReportReady`.

**Webhook `deliverReport`** (telegram route, fired when `RespondResult.reportRequest`
is set): ack text ("🔍 Building your research report — about a minute ⏳", or
"📄 Pulling up your research report ⏳" when a ready cached row exists) → same
cache/dedup/rate-limit flow as the route → snapshot → `toPropertyInput`/
`toIncomeInput` → `bestUnderwriting` → generate → `reportToPdf(report, { address,
preparedBy })` → `sendDocument("osprey-report-<listingId>.pdf", pdf, caption)`,
caption `"<address> · $<cashflow>/mo cash flow · https://getosprey.ai/property/<id>"`.
Friendly error texts per failure class; `maxDuration = 300` on the route.

**ReportPanel**: generate button POSTs the route and awaits; on 409 polls by
re-POSTing without `force` every 10s up to 3 min; auto-resumes that poll on mount
when the stored row is 'generating'; ready → sections + "Download PDF" + regenerate;
failed → retry.

## `generatePropertyReport` + prompt (verbatim from src/osprey/reports/generate.ts pre-teardown)

```ts
import Anthropic from "@anthropic-ai/sdk";

export const REPORT_MODEL = "claude-sonnet-5";

// (ReportSchema / SECTION_JSON / REPORT_JSON_SCHEMA remain in generate.ts today —
// the JSON-schema mirror had additionalProperties:false and explicit required
// arrays per structured-outputs rules, sections: headline + summary, dealNumbers,
// rentComps, neighborhood, marketTrends, risks, negotiationAngles, bottomLine.)

export interface ReportInputs {
  listing: RentCastListing;
  rent: RentCastRentEstimate | null;
  /** Underwriting at the user's best-cash-flow financing profile. */
  underwriting: Underwriting;
  projection: Projection;
  buyBox: BuyBox;
}

const SYSTEM_PROMPT = [
  "You are a senior residential real-estate underwriter writing a client-facing",
  "research report for a small buy-and-hold investor. You are given a specific",
  "listing, an AVM rent estimate with comparables, and a full underwriting run",
  "at the investor's own financing. Ground every neighborhood, school, crime,",
  "appreciation, and market-trend claim in a web search — do not invent local",
  "facts. Where a number comes from the provided underwriting, cite it exactly.",
  "Be candid about risks; this is a decision tool, not a sales sheet. Write in",
  "clear markdown prose. Return ONLY the structured JSON in the required format.",
].join(" ");

function money(n: number): string {
  return `$${Math.round(n).toLocaleString("en-US")}`;
}

/** Compact, model-legible dump of the numbers so the report is grounded. */
function buildUserContent(inputs: ReportInputs): string {
  const { listing, rent, underwriting: uw, projection: proj, buyBox } = inputs;
  const m = uw.metrics;
  const addr = listing.formattedAddress ?? listing.addressLine1 ?? "the property";

  const lines: string[] = [];
  lines.push(`PROPERTY: ${addr}`);
  lines.push(
    `Type ${uw.property.propertyType} (${uw.property.units} unit(s)), ` +
      `${listing.bedrooms ?? "?"} bd / ${listing.bathrooms ?? "?"} ba, ` +
      `${listing.squareFootage ?? "?"} sqft, built ${listing.yearBuilt ?? "?"}.`,
  );
  lines.push(
    `List price ${money(uw.property.price)}, days on market ${listing.daysOnMarket ?? "?"}.`,
  );

  lines.push("");
  lines.push("RENT ESTIMATE (RentCast AVM):");
  if (rent) {
    lines.push(
      `Monthly rent ${money(rent.rent ?? uw.monthly.grossRent)}, range ` +
        `${money(rent.rentRangeLow ?? 0)}–${money(rent.rentRangeHigh ?? 0)}, ` +
        `${rent.comparables?.length ?? 0} comparables.`,
    );
    if (rent.comparables?.length) {
      lines.push(`Comparables (raw JSON): ${JSON.stringify(rent.comparables).slice(0, 4000)}`);
    }
  } else {
    lines.push(`Manual/override rent ${money(uw.monthly.grossRent)} (no AVM comparables).`);
  }

  lines.push("");
  lines.push(`UNDERWRITING (financing: ${uw.loan.label}):`);
  lines.push(
    `Monthly cash flow ${money(uw.monthlyCashFlow)}, annual ${money(uw.annualCashFlow)}, ` +
      `cash to close ${money(uw.cashToClose)}.`,
  );
  lines.push(
    `Cap rate ${m.capRatePct.toFixed(2)}%, CoC ${m.cashOnCashPct.toFixed(2)}%, ` +
      `GRM ${m.grossRentMultiplier.toFixed(1)}, rent-to-value ${m.rentToValuePct.toFixed(2)}% ` +
      `(1% rule: ${m.onePercentRule ? "pass" : "fail"}), ` +
      `lender DSCR ${m.lenderDscr?.toFixed(2) ?? "n/a"}, ` +
      `break-even occupancy ${m.breakEvenOccupancyPct.toFixed(1)}%.`,
  );
  lines.push(
    `Loan: ${money(uw.loan.downPayment)} down, ${money(uw.loan.amountFinanced)} financed at ` +
      `${(uw.loan.rate * 100).toFixed(3)}% over ${uw.loan.termYears}y; ` +
      `P&I ${money(uw.loan.monthlyPrincipalAndInterest)}/mo.`,
  );
  lines.push(
    `Qualification: ${uw.qualification.pass ? "passes" : "fails"} — ` +
      uw.qualification.checks.map((c) => `${c.name} ${c.pass ? "✓" : "✗"}`).join(", "),
  );

  const exit = proj.years[proj.years.length - 1];
  if (exit) {
    lines.push("");
    lines.push(`${proj.years.length}-YEAR PROJECTION:`);
    lines.push(
      `Exit value ${money(exit.propertyValue)}, equity ${money(exit.equity)}, ` +
        `total profit ${money(proj.totalProfitAtExit)}, ` +
        `IRR ${proj.irrAtExitPct?.toFixed(1) ?? "n/a"}%, ` +
        `equity multiple ${proj.equityMultipleAtExit?.toFixed(2) ?? "n/a"}x.`,
    );
  }

  lines.push("");
  lines.push("INVESTOR BUY BOX:");
  lines.push(
    `Cities ${(buyBox.cities ?? []).join(", ") || "any"}; ` +
      `types ${buyBox.propertyTypes.join(", ")}; ` +
      `price ${money(buyBox.minPrice ?? 0)}–${money(buyBox.maxPrice ?? 0)}.`,
  );

  lines.push("");
  lines.push(
    "Write the report. Use web search for neighborhood quality, schools, crime, " +
      "rental demand, and local market/appreciation trends for this address's area.",
  );
  return lines.join("\n");
}

/** Generate a structured research report. Throws if ANTHROPIC_API_KEY is unset
 *  or the model output can't be parsed against ReportSchema. */
export async function generatePropertyReport(
  inputs: ReportInputs,
  opts: { apiKey?: string } = {},
): Promise<{ report: PropertyReport; model: string }> {
  const apiKey = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error("ANTHROPIC_API_KEY is not configured.");
  }

  const client = new Anthropic({ apiKey });

  const message = await client.messages.create({
    model: REPORT_MODEL,
    max_tokens: 16000,
    system: SYSTEM_PROMPT,
    tools: [{ type: "web_search_20260209", name: "web_search", max_uses: 3 }],
    output_config: {
      effort: "medium",
      format: { type: "json_schema", schema: REPORT_JSON_SCHEMA },
    },
    messages: [{ role: "user", content: buildUserContent(inputs) }],
  });

  const text = message.content
    .filter((b): b is Anthropic.TextBlock => b.type === "text")
    .map((b) => b.text)
    .join("");
  if (!text.trim()) {
    throw new Error("Report model returned no text content.");
  }

  const report = ReportSchema.parse(JSON.parse(text));
  return { report, model: message.model ?? REPORT_MODEL };
}
```

Re-enable options: restore this on Anthropic (`npm i @anthropic-ai/sdk`, key back),
or port `generatePropertyReport` to the OpenRouter client in `src/osprey/llm/` —
grounding then needs OpenRouter's web plugin (~$0.005/report) since free models
have no server-side search.
