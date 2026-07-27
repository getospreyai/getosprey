// Feature flags.
//
// Agent accounts ship dark: the schema, authorization layer, and UI can all
// land on production while the flag is off, so a rollback is an env-var change
// rather than a revert. Every agent-only route and nav entry checks this.
//
// The flag gates VISIBILITY, never authorization. resolveScope() enforces
// access regardless of it — a flag flipped on by mistake must not grant anyone
// data they could not already reach.

/** True when agent/brokerage account features are exposed in the product. */
export function agentAccountsEnabled(): boolean {
  return process.env.OSPREY_AGENT_ACCOUNTS === "true";
}
