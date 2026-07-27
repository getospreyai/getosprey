// Read-only schema verifier. Asserts the columns ensureSchema() is supposed to
// have created actually exist in the target database, and reports row counts
// for the tables a migration touches.
//
// Purpose: ensureSchema() is all CREATE TABLE IF NOT EXISTS plus (as of
// 2026-07-26) a few ALTER TABLE ... ADD COLUMN IF NOT EXISTS. Both are silent
// no-ops when they have already run, which is exactly what makes a migration
// that DIDN'T run indistinguishable from one that did. This script is the
// check — run it against a Neon branch before prod, then against prod after.
//
// Reads schema metadata only. It never selects user data and never writes.
//
//   node scripts/verify-schema.mjs                  # uses DATABASE_URL, or .env.local
//   node scripts/verify-schema.mjs --branch         # uses NEON_BRANCH_URL from .env.local
//   DATABASE_URL="postgres://..." node scripts/verify-schema.mjs
//
// The --branch form exists so a Neon branch can be rehearsed without its
// connection string ever being pasted anywhere but .env.local (gitignored).
//
// Exits non-zero if any expected column is missing.

import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";

/** Columns that must exist for the current code to work. Add a row here in the
 *  same commit that adds the migration — that is what makes this a check and
 *  not a description. */
const EXPECTED = [
  // Wave: scan coverage (2026-07-26) — the first ALTERs in ensureSchema().
  ["scan_runs", "markets_requested"],
  ["scan_runs", "markets_scanned"],
  ["scan_runs", "markets_dropped"],
  // Wave: agent accounts phase 0 (2026-07-26).
  ["users", "role"],
  ["users", "status"],
  ["agent_clients", "agent_user_id"],
  ["agent_clients", "client_user_id"],
  ["agent_clients", "archived_at"],
  // Wave: agent accounts phase 2 (2026-07-27) — invites + claiming.
  // token_hash and NOT token: if a column named `token` ever shows up on this
  // table, the raw-token version got resurrected. See docs/PHASE-2-INVITES-PLAN.md §3.1.
  ["client_invites", "token_hash"],
  ["client_invites", "expires_at"],
  ["client_invites", "accepted_at"],
  ["client_invites", "revoked_at"],
  ["client_consents", "policy_version"],
  ["client_consents", "disclosure"],
  // Pre-existing core columns, as a sanity check that we are pointed at a real
  // Osprey database and not an empty one.
  ["users", "email"],
  ["investor_profiles", "telegram_chat_id"],
  ["verdicts", "listing_id"],
];

/** Columns that MUST be nullable for the current code to work. A migration
 *  that silently failed to drop a NOT NULL is invisible until an insert
 *  explodes in production. */
const EXPECTED_NULLABLE = [["users", "password_hash"]];

/** Columns that must NOT exist — a schema assertion in the negative.
 *
 *  client_invites.token would mean the raw-token design came back: invite
 *  tokens are bearer credentials for becoming another user's account, so the
 *  database stores sha256(token) and never the token itself
 *  (docs/PHASE-2-INVITES-PLAN.md §3.1). A well-meaning "add the token back so
 *  agents can re-copy the link" change would silently reintroduce that, and
 *  nothing else in the codebase would fail. This is the check that would. */
const FORBIDDEN = [["client_invites", "token"]];

/** Tables whose row counts are worth seeing before/after a migration. */
const COUNT_TABLES = [
  "users",
  "investor_profiles",
  "verdicts",
  "scan_runs",
  "client_invites",
  "client_consents",
];

const useBranch = process.argv.includes("--branch");
/** Which .env.local key to read. --branch targets a Neon branch so a migration
 *  can be rehearsed without touching prod. */
const ENV_KEY = useBranch ? "NEON_BRANCH_URL" : "DATABASE_URL";

function resolveConnectionString() {
  if (!useBranch && process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env[ENV_KEY]) return process.env[ENV_KEY];
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const match = env.match(new RegExp(`^\\s*${ENV_KEY}\\s*=\\s*(.+)$`, "m"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // fall through
  }
  return "";
}

const connectionString = resolveConnectionString();
if (!connectionString) {
  console.error(`verify-schema: no ${ENV_KEY} (env or .env.local).`);
  if (useBranch) {
    console.error("Add NEON_BRANCH_URL=<branch connection string> to .env.local.");
  }
  process.exit(2);
}

// Never print the connection string — host only, so it is obvious which
// database (prod vs branch) was checked without leaking credentials.
const host = connectionString.match(/@([^/?]+)/)?.[1] ?? "(unknown host)";
console.log(`verify-schema: ${host}\n`);

const sql = neon(connectionString);

const rows = await sql`
  SELECT table_name, column_name, data_type, is_nullable
  FROM information_schema.columns
  WHERE table_schema = 'public'
`;

const present = new Set(rows.map((r) => `${r.table_name}.${r.column_name}`));
const typeOf = new Map(rows.map((r) => [`${r.table_name}.${r.column_name}`, r.data_type]));
const nullableOf = new Map(
  rows.map((r) => [`${r.table_name}.${r.column_name}`, r.is_nullable === "YES"]),
);

let missing = 0;
console.log("Expected columns:");
for (const [table, column] of EXPECTED) {
  const key = `${table}.${column}`;
  const ok = present.has(key);
  if (!ok) missing++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${key}${ok ? `  (${typeOf.get(key)})` : ""}`);
}

// Counted separately from `missing`: a column that exists but kept its NOT
// NULL is a different failure, and reporting it as "missing" sends whoever is
// running the migration gate hunting for a column that is right there.
let notNullable = 0;
console.log("\nExpected nullable:");
for (const [table, column] of EXPECTED_NULLABLE) {
  const key = `${table}.${column}`;
  const ok = nullableOf.get(key) === true;
  if (!ok) notNullable++;
  const detail = present.has(key) ? (ok ? "nullable" : "STILL NOT NULL") : "column absent";
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${key}  (${detail})`);
}

// A column that should not be there is a different failure again: nothing is
// broken today, but a security property the code depends on has quietly gone.
let forbidden = 0;
console.log("\nMust NOT exist:");
for (const [table, column] of FORBIDDEN) {
  const key = `${table}.${column}`;
  const ok = !present.has(key);
  if (!ok) forbidden++;
  console.log(`  ${ok ? "PASS" : "FAIL"}  ${key}${ok ? "  (absent)" : "  PRESENT — see PHASE-2-INVITES-PLAN.md §3.1"}`);
}

console.log("\nRow counts:");
for (const table of COUNT_TABLES) {
  if (!rows.some((r) => r.table_name === table)) {
    console.log(`  --    ${table} (table not present)`);
    continue;
  }
  // Table names cannot be parameterized; these come from the local
  // COUNT_TABLES constant above, never from user input. sql.query() is the
  // non-tagged-template form @neondatabase/serverless requires here.
  const [{ n }] = await sql.query(`SELECT count(*)::int AS n FROM ${table}`);
  console.log(`  ${String(n).padStart(6)}  ${table}`);
}

if (missing > 0 || notNullable > 0 || forbidden > 0) {
  const parts = [];
  if (missing > 0) parts.push(`${missing} expected column(s) MISSING`);
  if (notNullable > 0) parts.push(`${notNullable} column(s) STILL NOT NULL`);
  if (forbidden > 0) parts.push(`${forbidden} forbidden column(s) PRESENT`);
  console.error(`\nverify-schema: ${parts.join("; ")}.`);
  if (missing > 0 || notNullable > 0) {
    console.error("ensureSchema() has not fully run against this database since the migration landed.");
  }
  if (forbidden > 0) {
    console.error("A column that must not exist is present — this is a security regression, not a missing migration.");
  }
  process.exit(1);
}
console.log("\nverify-schema: all expected columns present, correctly nullable, no forbidden columns.");
