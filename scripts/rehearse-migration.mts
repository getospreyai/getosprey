// Run the REAL ensureSchema() against the Neon rehearsal branch.
//
// Ship gate #4 (docs/AGENT-ACCOUNTS-PLAN.md): no migration touches prod's users
// table until it has run against a branch carrying real data. In production
// ensureSchema() fires on the first request to a route that calls it — this is
// the same function, invoked deliberately instead of incidentally.
//
//   node --experimental-strip-types scripts/rehearse-migration.mts
//
// SAFETY: this script targets NEON_BRANCH_URL and nothing else. There is no
// flag, env var, or fallback that points it at DATABASE_URL — a rehearsal tool
// that can reach production is not a rehearsal tool. It also refuses to run if
// the branch URL happens to equal DATABASE_URL.

import { readFileSync } from "node:fs";

function fromEnvLocal(key: string): string {
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const match = env.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
    return match ? match[1].trim().replace(/^["']|["']$/g, "") : "";
  } catch {
    return "";
  }
}

const branchUrl = process.env.NEON_BRANCH_URL || fromEnvLocal("NEON_BRANCH_URL");
if (!branchUrl) {
  console.error("rehearse-migration: no NEON_BRANCH_URL (env or .env.local).");
  process.exit(2);
}

/**
 * Identity of the DATABASE a URL addresses, for comparison.
 *
 * Not the raw string: Neon exposes a pooled and a direct endpoint for the same
 * branch (`ep-x-pooler.<region>...` and `ep-x.<region>...`), which are
 * different URLs pointing at the SAME data. Comparing raw strings would let
 * production's direct URL past a guard whose whole job is to keep this script
 * off production. Credentials and query params are irrelevant here and are
 * deliberately excluded.
 */
function dbIdentity(url: string): string {
  const host = (url.match(/@([^/?]+)/)?.[1] ?? "").toLowerCase();
  const dbName = (url.match(/@[^/]+\/([^/?]+)/)?.[1] ?? "").toLowerCase();
  const endpoint = host.split(".")[0].replace(/-pooler$/, "");
  return `${endpoint}/${dbName}`;
}

const prodUrl = process.env.DATABASE_URL || fromEnvLocal("DATABASE_URL");
if (!prodUrl) {
  // Without production's URL there is nothing to compare against, so the guard
  // below cannot fire. Refuse rather than run unprotected — this is exactly
  // the setup (prod URL only in Vercel) where a stale NEON_BRANCH_URL would go
  // unnoticed.
  console.error("rehearse-migration: DATABASE_URL is not available to compare against.");
  console.error("Cannot confirm NEON_BRANCH_URL is not production. Refusing to run.");
  console.error("Set DATABASE_URL (env or .env.local) so the safety check can run.");
  process.exit(2);
}
if (dbIdentity(branchUrl) === dbIdentity(prodUrl)) {
  console.error("rehearse-migration: NEON_BRANCH_URL resolves to the SAME database as");
  console.error(`DATABASE_URL (${dbIdentity(prodUrl)}) — refusing to run.`);
  console.error("That would migrate production. Point NEON_BRANCH_URL at a branch.");
  process.exit(2);
}

const host = branchUrl.match(/@([^/?]+)/)?.[1] ?? "(unknown host)";
console.log(`rehearse-migration: target ${host}`);

// db.ts reads DATABASE_URL at module load, so set it BEFORE importing and use a
// dynamic import — a static import would be hoisted above this assignment.
process.env.DATABASE_URL = branchUrl;
process.env.POSTGRES_URL = branchUrl;

const { ensureSchema } = await import("../src/lib/db.ts");

const started = Date.now();
await ensureSchema();
console.log(`rehearse-migration: ensureSchema() completed in ${Date.now() - started}ms`);
console.log("Now run: node scripts/verify-schema.mjs --branch");
