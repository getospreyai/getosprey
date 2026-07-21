// Single source of truth for the compliance copy repeated across the product
// (page footers, the PDF packet/report, the Telegram bot). Wording tracks
// Terms of Service §3-4 (see src/app/terms/page.tsx) — update both together
// rather than letting per-surface copies drift.

/** One line, for tight spots: PDF footers, chat replies. */
export const DISCLAIMER_SHORT =
  "Informational only — not investment, legal, tax, or brokerage advice. Estimates may be inaccurate; verify independently.";

/** 2-3 sentences, for a fine-print card on a full page. */
export const DISCLAIMER_FULL =
  "Osprey is for informational and educational purposes only — it is not investment, legal, tax, financial, or real-estate brokerage advice. Figures are estimates generated from third-party data and AI and may be inaccurate, incomplete, or out of date, so do your own due diligence and consult licensed professionals before acting. Projections are hypothetical and do not guarantee future results.";

/** One line, for surfaces where an AI-generated answer appears. */
export const AI_DISCLAIMER = "Answers are AI-generated and may be inaccurate — verify before acting.";
