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
export const EFFECTIVE_DATE = "July 27, 2026";

/**
 * The version a consent record is written against — see client_consents.
 *
 * Ship gate #5 (docs/AGENT-ACCOUNTS-PLAN.md §9a): Phase 2 does not ship
 * without the reviewed privacy/ToS update and a recorded consent step. A
 * consent row that does not say WHICH text was agreed to is not evidence of
 * anything, and today there is no agent-relationship text to point at: neither
 * /privacy nor /terms mentions agents at all.
 *
 * It read PROVISIONAL until 2026-07-27, and while it did:
 *
 *   1. the claim path refused to run (POST /api/claim returned 503 rather than
 *      recording a consent it could not describe), and
 *   2. tests/policy-version.test.ts FAILED if OSPREY_AGENT_ACCOUNTS was "true".
 *
 * That is what turned the gate from a line in a planning document into a
 * failing build, and it did its job: nothing shipped until the copy existed.
 *
 * **Set 2026-07-27, when the agent-relationship sections landed on /privacy
 * (§2 bullet, §10 amendment, new §13, §14 retention) and /terms (§5 amendment,
 * new §16).** The drafts and the reasoning behind every sentence are in
 * docs/PRIVACY-TOS-AGENT-DRAFT.md; §D of that document lists the questions
 * that were accepted on the operator's own judgment rather than a lawyer's.
 *
 * It must equal EFFECTIVE_DATE above — a consent row recording a version no
 * page displays is not evidence of anything, and policy-version.test.ts
 * asserts the two match now that this is no longer provisional.
 *
 * Any future material change to what an agent can see needs a NEW date here
 * and on both pages, in the same commit. Consent recorded against this string
 * is consent to the text that was live under it.
 *
 * Annotated `: string` rather than left to literal inference on purpose. Without
 * it TypeScript narrows this to the literal `"July 27, 2026"` and then reports
 * `policyVersionIsReviewed()`'s comparison as an impossible one — which would
 * push the next person to delete the guard as dead code. It is not dead: it is
 * what makes setting this back to PROVISIONAL a working kill switch rather than
 * a type error.
 */
export const POLICY_VERSION: string = "July 27, 2026";

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
  "Your agent set up this account without any information about you — Osprey has never held your name or your email address, and was not told who your agent sent this link to. That changes when you claim it: the name and email you enter here become part of the account your agent can see.",
  "Your agent will be able to see: your name and email address, your buy box (the markets, property types, and price range you're looking at), your financing assumptions, your minimum monthly cash-flow target, every listing Osprey underwrites for you, and any property reports or share links generated for your account.",
  "Your agent cannot read your conversations with our Telegram bot or the notes we keep from them, cannot change your email or password, cannot delete your account, cannot see your login history, and cannot see anything about any other Osprey user.",
  "You can disconnect from your agent at any time in Settings. Disconnecting immediately ends their access to everything above. Reports your agent already generated stay with them; any share links on your account stop working, and you can create new ones at any time.",
].join("\n\n");
