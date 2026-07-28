// Run the dev server against NEON_BRANCH_URL instead of production.
//
// Step 6 of docs/PHASE-2-MIGRATION-REHEARSAL.md — "confirm the app still works
// against the branch" — previously gave a bash-only incantation
// (`DATABASE_URL="$NEON_BRANCH_URL" npm run dev`) that does nothing useful on
// Windows, where this project is actually developed. A gate you cannot run is
// not a gate.
//
// It matters more than convenience: src/auth.ts calls ensureSchema() on the
// SIGN-IN path, so starting an ordinary `npm run dev` against a .env.local
// whose DATABASE_URL points at production and then signing in applies every
// pending migration to production — which is exactly what ship gate #4 exists
// to prevent. This script makes the safe thing the easy thing.
//
// Guardrails mirror scripts/rehearse-migration.mts: it refuses to run without
// both URLs, and refuses if they resolve to the same database. There is no
// flag that points it at production.

import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";

function fromEnvLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const match = env.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
    if (match) return match[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // fall through
  }
  return "";
}

/** Neon endpoint identity, so a pooled and a direct URL for one branch compare
 *  equal. Same rule as scripts/rehearse-migration.mts. */
function dbIdentity(url) {
  const host = url.match(/@([^/?]+)/)?.[1] ?? "";
  return host.replace("-pooler", "");
}

const branchUrl = fromEnvLocal("NEON_BRANCH_URL");
const prodUrl = fromEnvLocal("DATABASE_URL");

if (!branchUrl) {
  console.error("dev-branch: no NEON_BRANCH_URL (env or .env.local).");
  console.error("Create a Neon branch first — docs/PHASE-2-MIGRATION-REHEARSAL.md step 1.");
  process.exit(2);
}
if (!prodUrl) {
  console.error("dev-branch: no DATABASE_URL to compare against.");
  console.error("Refusing to run: without it there is no way to prove this is not production.");
  process.exit(2);
}
if (dbIdentity(branchUrl) === dbIdentity(prodUrl)) {
  console.error("dev-branch: NEON_BRANCH_URL and DATABASE_URL are the same database.");
  console.error("Refusing to run. The whole point is to exercise a branch, not production.");
  process.exit(2);
}

// Extra KEY=VALUE arguments become environment variables for the dev server —
// the point being that a feature flag can be exercised against the branch
// WITHOUT editing .env.local, where a forgotten "true" would silently follow
// you back to production work.
//
//   npm run dev:branch -- OSPREY_ADMIN_UI=true OSPREY_ADMIN_EMAILS=you@example.com
//
// DATABASE_URL is not accepted here: overriding it would defeat every guard above.
const extraEnv = {};
for (const arg of process.argv.slice(2)) {
  const match = arg.match(/^([A-Z_][A-Z0-9_]*)=(.*)$/);
  if (!match) {
    console.error(`dev-branch: unrecognised argument ${JSON.stringify(arg)} (expected KEY=VALUE).`);
    process.exit(2);
  }
  if (match[1] === "DATABASE_URL") {
    console.error("dev-branch: refusing to let DATABASE_URL be overridden from the command line.");
    process.exit(2);
  }
  extraEnv[match[1]] = match[2];
}

console.log(`dev-branch: serving against ${dbIdentity(branchUrl)} (branch, NOT production)`);
for (const key of Object.keys(extraEnv)) console.log(`dev-branch: ${key} set for this run only`);
console.log("");

// Next.js does not override values already present in process.env, so setting
// DATABASE_URL here wins over the .env.local entry.
const child = spawn("npx", ["next", "dev"], {
  stdio: "inherit",
  shell: true,
  env: { ...process.env, ...extraEnv, DATABASE_URL: branchUrl },
});
child.on("exit", (code) => process.exit(code ?? 0));
