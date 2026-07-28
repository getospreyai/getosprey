// Seed (or remove) the test accounts that cover every user state the product
// can put someone in.
//
//   node scripts/seed-test-accounts.mjs                    # -> Neon branch
//   node scripts/seed-test-accounts.mjs --prod --i-mean-it # -> PRODUCTION
//   node scripts/seed-test-accounts.mjs --destroy          # remove them again
//
// WHY THESE ACCOUNTS ARE SAFE TO PUT IN PRODUCTION
//
// 1. Every address is at `osprey-test.invalid`. `.invalid` is reserved by
//    RFC 2606 precisely so it can never resolve — these addresses cannot
//    receive mail, cannot be registered by anyone, and cannot collide with a
//    real user. Nothing here can ever reach a real inbox.
//
// 2. Every name starts with TEST, so they are obvious in /admin at a glance
//    rather than looking like real signups in the user count.
//
// 3. Every buy box is NV-wide, matching the market Osprey already scans.
//    `deriveMarkets()` dedupes by market, so these accounts add ZERO RentCast
//    calls to the cron — the cost of a scan is per market, not per profile.
//    Putting them in, say, Honolulu would have added a full paginated pull per
//    run. This is the single most important line in this file.
//
// 4. `alertsPaused: true` on every profile, and no Telegram chat is bound, so
//    the loop logs verdicts and never attempts to message anyone.
//
// 5. `--destroy` removes exactly what this script created, matched on the email
//    domain. `ON DELETE CASCADE` from `users` takes the profiles, verdicts,
//    roster rows, and invites with them. `client_consents` deliberately keeps
//    an anonymized row — see the A6 note in db/schema.sql; that is the design,
//    not a leak.
//
// Production still requires BOTH --prod and --i-mean-it. One flag is a typo;
// two is a decision.

import { neon } from "@neondatabase/serverless";
import { readFileSync } from "node:fs";
import { randomUUID, createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";

const DOMAIN = "osprey-test.invalid";
/** Printed at the end. Test-only, and only usable against a database seeded by
 *  this script — every account it unlocks is one this script created. */
const PASSWORD = "TestAccount!2026";

const args = process.argv.slice(2);
const wantProd = args.includes("--prod");
const confirmed = args.includes("--i-mean-it");
const destroy = args.includes("--destroy");

function fromEnvLocal(key) {
  if (process.env[key]) return process.env[key];
  try {
    const env = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
    const m = env.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`, "m"));
    if (m) return m[1].trim().replace(/^["']|["']$/g, "");
  } catch {
    // fall through
  }
  return "";
}

const key = wantProd ? "DATABASE_URL" : "NEON_BRANCH_URL";
const url = fromEnvLocal(key);
if (!url) {
  console.error(`seed-test-accounts: no ${key} (env or .env.local).`);
  process.exit(2);
}
if (wantProd && !confirmed) {
  console.error("seed-test-accounts: --prod requires --i-mean-it as well.");
  console.error("This writes accounts to the production users table. Two flags, not one.");
  process.exit(2);
}

const host = url.match(/@([^/?]+)/)?.[1] ?? "(unknown)";
console.log(`seed-test-accounts: ${host} ${wantProd ? "*** PRODUCTION ***" : "(branch)"}\n`);

const sql = neon(url);

// --- teardown --------------------------------------------------------------

if (destroy) {
  const doomed = await sql`SELECT id, email FROM users WHERE email LIKE ${"%@" + DOMAIN}`;
  if (doomed.length === 0) {
    console.log("Nothing to remove.");
    process.exit(0);
  }
  for (const u of doomed) console.log(`  removing ${u.email}`);
  // Managed clients get a synthetic address on a different domain, so they are
  // matched through the roster rather than by email.
  await sql`
    DELETE FROM users
     WHERE email LIKE ${"%@" + DOMAIN}
        OR id IN (
          SELECT client_user_id FROM agent_clients
           WHERE agent_user_id IN (SELECT id FROM users WHERE email LIKE ${"%@" + DOMAIN})
        )
  `;
  console.log(`\nRemoved ${doomed.length} account(s) and everything cascading from them.`);
  process.exit(0);
}

// --- shapes ----------------------------------------------------------------

/** NV-wide, matching the market already scanned. See note 3 above. */
const buyBox = {
  states: ["NV"],
  propertyTypes: ["duplex", "triplex", "fourplex"],
  maxPrice: 600000,
};

const financing = [
  { kind: "conventional", downPct: 0.25, ratePct: 6.75, termYears: 30, label: "Conventional — 25% down" },
];

function profile(id, name) {
  return {
    id,
    name,
    buyBox,
    financingProfiles: financing,
    minMonthlyCashFlow: 200,
    // Belt and braces: nothing can be sent anyway (no chat bound), but this
    // makes "never messages a test account" true at the loop level too.
    alertsPaused: true,
    // MANDATORY or the cron's isScannable() filter skips the account forever
    // with no error — AGENT-ACCOUNTS-PLAN.md §5.
    onboarded: true,
  };
}

const hash = await bcrypt.hash(PASSWORD, 10);
const created = [];

async function makeUser({ email, name, role = "investor", status = "active", withPassword = true }) {
  const id = randomUUID();
  await sql`
    INSERT INTO users (id, email, password_hash, name, role, status)
    VALUES (${id}, ${email}, ${withPassword ? hash : null}, ${name}, ${role}, ${status})
  `;
  created.push({ email, name, role, status, canSignIn: withPassword && status === "active" });
  return id;
}

async function makeProfile(id, name) {
  await sql`
    INSERT INTO investor_profiles (user_id, profile)
    VALUES (${id}, ${JSON.stringify(profile(id, name))}::jsonb)
  `;
}

// --- the account matrix ----------------------------------------------------

console.log("Creating:\n");

// 1. An ordinary solo investor — the control. Every regression check about
//    "solo behaviour is unchanged" needs one of these to be true about.
const soloId = await makeUser({ email: `solo@${DOMAIN}`, name: "TEST Solo Investor" });
await makeProfile(soloId, "TEST Solo Investor");
console.log("  1. solo investor            active   / investor");

// 2. The agent. Farm is NV-wide so every client below sits inside it.
const agentId = await makeUser({
  email: `agent@${DOMAIN}`,
  name: "TEST Agent",
  role: "agent",
});
await makeProfile(agentId, "TEST Agent");
await sql`
  INSERT INTO agent_settings (agent_user_id, farm_markets)
  VALUES (${agentId}, ${JSON.stringify([{ state: "NV" }])}::jsonb)
  ON CONFLICT (agent_user_id) DO UPDATE SET farm_markets = EXCLUDED.farm_markets
`;
console.log("  2. agent                    active   / agent      (farm: NV)");

/** A client on the agent's roster. Managed clients carry a synthetic address on
 *  the clients.osprey.invalid domain, matching PgStore.createManagedClient. */
async function makeClient({ label, status, realEmail, archived = false }) {
  const id = randomUUID();
  const email =
    status === "active" ? `${label}@${DOMAIN}` : `managed-${id}@clients.osprey.invalid`;
  await sql`
    INSERT INTO users (id, email, password_hash, name, role, status)
    VALUES (${id}, ${email}, ${status === "active" ? hash : null},
            ${"TEST " + label + " client"}, 'investor', ${status})
  `;
  await makeProfile(id, `TEST ${label} client`);
  await sql`
    INSERT INTO agent_clients (agent_user_id, client_user_id, label, client_email, archived_at)
    VALUES (${agentId}, ${id}, ${label}, ${realEmail},
            ${archived ? new Date().toISOString() : null})
  `;
  created.push({
    email,
    name: `TEST ${label} client`,
    role: "investor",
    status,
    canSignIn: status === "active",
  });
  return id;
}

// 3. Managed — the Phase 1 state. Agent owns the buy box; cannot sign in.
await makeClient({ label: "managed", status: "managed", realEmail: `managed.real@${DOMAIN}` });
console.log("  3. managed client           managed  / no password, agent can edit");

// 4. Invited — an outstanding invite. The claim URL is printed below.
const invitedId = await makeClient({
  label: "invited",
  status: "invited",
  realEmail: `invited.real@${DOMAIN}`,
});
const token = "osp_inv_" + randomBytes(32).toString("base64url");
await sql`
  INSERT INTO client_invites (token_hash, agent_user_id, client_user_id, email, expires_at)
  VALUES (${createHash("sha256").update(token, "utf8").digest("hex")},
          ${agentId}, ${invitedId}, ${`invited.real@${DOMAIN}`},
          ${new Date(Date.now() + 7 * 864e5).toISOString()})
`;
console.log("  4. invited client           invited  / live invite token");

// 5. Claimed — the client owns their data now, so the agent drops to read-only
//    (resolveScope returns canEdit: false once clientStatus is 'active').
await makeClient({ label: "claimed", status: "active", realEmail: `claimed.real@${DOMAIN}` });
console.log("  5. claimed client           active   / agent is READ-ONLY");

// 6. Disconnected — roster row archived. resolveScope refuses the agent
//    entirely, and the client shows up in the agent's "recently disconnected"
//    section, which reads its reason from the consent ledger.
const goneId = await makeClient({
  label: "disconnected",
  status: "active",
  realEmail: `disconnected.real@${DOMAIN}`,
  archived: true,
});
await sql`
  INSERT INTO client_consents (user_id, agent_user_id, kind, policy_version, disclosure)
  VALUES (${goneId}, ${agentId}, 'withdraw', 'July 27, 2026',
          'Seeded test account: disconnected from Settings.')
`;
console.log("  6. disconnected client      active   / roster row archived");

// 7. Suspended — nothing can set this yet; admin v1b is what will. Seeded now
//    so the state exists to build against, and because canActAsViewer()
//    already refuses it, which is worth confirming against a real row.
await makeUser({
  email: `suspended@${DOMAIN}`,
  name: "TEST Suspended User",
  status: "suspended",
});
console.log("  7. suspended user           suspended/ must not hold a session");

// --- summary ---------------------------------------------------------------

console.log(`\n${created.length} accounts created on ${wantProd ? "PRODUCTION" : "the branch"}.\n`);
console.log(`Password for every signable account: ${PASSWORD}`);
console.log("Sign-in works for: solo, agent, claimed client, disconnected client.");
console.log("Cannot sign in (by design): managed, invited, suspended.\n");
console.log(`Claim URL for account 4:\n  <origin>/claim/${token}`);
console.log("  (shown once — only the sha256 is stored)\n");
console.log("Remove them all again with:  node scripts/seed-test-accounts.mjs --destroy");
if (wantProd) console.log("                              ...plus --prod --i-mean-it");
