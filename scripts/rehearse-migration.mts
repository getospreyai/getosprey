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

const prodUrl = process.env.DATABASE_URL || fromEnvLocal("DATABASE_URL");
if (prodUrl && branchUrl === prodUrl) {
  console.error("rehearse-migration: NEON_BRANCH_URL equals DATABASE_URL — refusing to run.");
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
