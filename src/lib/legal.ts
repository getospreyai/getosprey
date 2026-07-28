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

// ---------------------------------------------------------------------------
// Policy versioning — the programmatic half of ship gate #5.
// ---------------------------------------------------------------------------

/**
 * The effective date shown on /privacy and /terms.
 *
 * Fixed and hand-edited on material change. Must NOT auto-render "today": a
 * notice whose effective date silently tracks the clock is misleading and
 * defeats the NRS 603A.340(1)(e) element it exists to satisfy.
 *
 * Hoisted here from the two pages, which each held their own copy. They were
 * in sync only because nobody had edited one of them yet.
 */
export const EFFECTIVE_DATE = "July 21, 2026";

/**
 * The version a consent record is written against — see client_consents.
 *
 * Ship gate #5 (docs/AGENT-ACCOUNTS-PLAN.md §9a): Phase 2 does not ship
 * without the reviewed privacy/ToS update and a recorded consent step. A
 * consent row that does not say WHICH text was agreed to is not evidence of
 * anything, and today there is no agent-relationship text to point at: neither
 * /privacy nor /terms mentions agents at all.
 *
 * So this reads PROVISIONAL, and:
 *
 *   1. the claim path refuses to run while it does (POST /api/claim returns
 *      503 rather than recording a consent it cannot describe), and
 *   2. tests/policy-version.test.ts FAILS if OSPREY_AGENT_ACCOUNTS is "true"
 *      while it does.
 *
 * That is what turns the gate from a line in a planning document into a
 * failing build. When the reviewed copy lands, set this to the new effective
 * date — the same commit should update EFFECTIVE_DATE above.
 *
 * Do not set this to a real-looking date to "unblock" anything. The whole
 * point is that it cannot be satisfied without the copy existing.
 */
export const POLICY_VERSION = "PROVISIONAL";

/** Whether the legal copy required by ship gate #5 has actually landed. */
export function policyVersionIsReviewed(): boolean {
  return POLICY_VERSION !== "PROVISIONAL";
}

/**
 * What an agent can see about a client, stated plainly.
 *
 * This is the disclosure recorded verbatim in client_consents.disclosure at
 * claim time, and it must keep matching what ScopedStore actually exposes
 * (src/lib/scoped-store.ts). It is stored per-consent rather than referenced,
 * because a pointer to copy that lives in a source file stops being evidence
 * the moment that copy changes.
 *
 * PROVISIONAL WORDING. The substance is accurate today and is drawn from
 * ScopedStore's real surface, not from a guess — but the final phrasing is a
 * legal artifact and has to match the reviewed Privacy Policy section for
 * section. Ship gate #5 covers this; POLICY_VERSION is what enforces it.
 *
 * Every "cannot" claim is load-bearing and each is true as written:
 * ScopedStore has no method that touches credentials, loadProfile() redacts the
 * Telegram fields for an agent scope (see redactForAgent there), and the
 * disconnect path is real (POST /api/account/disconnect-agent). Do not ship
 * this copy if any of them stops being true.
 *
 * The final paragraph states DECISION-3 (Dylan, 2026-07-27): the agent's
 * reports survive a disconnect, the client's share links do not. It says "any
 * share links on your account", not "share links your agent created", because
 * disconnectAgent() revokes all of them — share_links does not record who
 * minted a token, and promising a narrower revocation than we perform is worse
 * than promising a wider one.
 */
export const AGENT_ACCESS_DISCLOSURE = [
  "Your agent will be able to see: your buy box (the markets, property types, and price range you're looking at), your financing assumptions, your minimum monthly cash-flow target, every listing Osprey underwrites for you, and any property reports or share links generated for your account.",
  "Your agent cannot read your conversations with our Telegram bot or the notes we keep from them, cannot change your email or password, cannot delete your account, cannot see your login history, and cannot see anything about any other Osprey user.",
  "You can disconnect from your agent at any time in Settings. Disconnecting immediately ends their access to everything above. Reports your agent already generated stay with them; any share links on your account stop working, and you can create new ones at any time.",
].join("\n\n");
