// Agent client roster. GET lists the agent's active clients; POST creates a
// new MANAGED client — a real users row the agent maintains a buy box for
// until the client claims the account (Phase 2).
//
// Two constraints are enforced here and nowhere else:
//
//  1. The client's buy box must fall inside the agent's farm markets. That is
//     the cost control for the daily scan (see src/lib/farm-markets.ts) and it
//     must be checked at write time, while the agent can still act on the
//     error — the alternative is a client who silently never gets scanned.
//
//  2. The new profile is written `onboarded: true`. The cron skips profiles
//     with onboarded === false, so an agent-created client left mid-setup
//     would never scan, forever, with no error raised anywhere.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { parseFarmMarkets, withinFarm } from "@/lib/farm-markets";
import { PatchProfileSchema, mergeProfileSettings } from "@/lib/profile-schema";
import { isScannable } from "@/osprey/agent/scannable";
import { PgStore } from "@/osprey/pg-store";
import type { InvestorProfile } from "@/osprey/agent/model";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

/**
 * REFERRAL MODEL (2026-07-27): no `name`, no `email`.
 *
 * An agent-created client is an anonymous saved search. `label` is the agent's
 * own reference for it and is the only human-meaningful string stored — Osprey
 * learns nothing about the person until they claim the account themselves and
 * supply their own address under a recorded consent.
 *
 * These fields are not merely optional, they are ABSENT: an extra key in the
 * body is ignored by zod rather than stored, so a stale client sending
 * `{ name, email }` degrades to storing neither instead of quietly persisting
 * them.
 */
const CreateClientSchema = z.object({
  label: z.string().trim().min(1).max(120),
  settings: PatchProfileSchema,
});

/** A managed client cannot log in, so its users.email is only an identifier.
 *  Keeping it synthetic means adding a client can never collide with an
 *  existing account, which would leak whether that address is registered. */
function syntheticEmail(clientUserId: string): string {
  return `managed-${clientUserId}@clients.osprey.invalid`;
}

function baseProfile(clientUserId: string, name: string): InvestorProfile {
  return {
    id: clientUserId,
    name,
    buyBox: { states: [], cities: [], propertyTypes: [] },
    financingProfiles: [],
    minMonthlyCashFlow: 0,
    // The agent completes setup in one step, so there is no wizard to finish.
    // This MUST be true or the cron's filter skips the client permanently.
    onboarded: true,
  };
}

export async function GET() {
  if (!agentAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }
  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const store = new PgStore();
  const clients = await store.listAgentClients(scoped.userId);
  return NextResponse.json({ clients }, NO_STORE);
}

export async function POST(req: NextRequest) {
  if (!agentAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }

  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Clients are temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const parsed = CreateClientSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some of those client details don't look right." },
      { status: 400, ...NO_STORE },
    );
  }

  const store = new PgStore();
  const agentUserId = scoped.userId;

  const clientUserId = crypto.randomUUID();
  const profile = mergeProfileSettings(
    baseProfile(clientUserId, parsed.data.label),
    parsed.data.settings,
  );

  // Cost control: reject before writing anything.
  const farm = parseFarmMarkets(await store.loadFarmMarkets(agentUserId));
  const farmCheck = withinFarm(profile.buyBox, farm);
  if (!farmCheck.ok) {
    return NextResponse.json({ error: farmCheck.reason }, { status: 400, ...NO_STORE });
  }

  // Refuse to create a client the daily scan would ignore. Without this the
  // agent gets a client row that looks fine and never produces a verdict.
  const scannable = isScannable(profile);
  if (!scannable.ok) {
    return NextResponse.json({ error: scannable.reason }, { status: 400, ...NO_STORE });
  }

  try {
    await store.createManagedClient({
      agentUserId,
      clientUserId,
      syntheticEmail: syntheticEmail(clientUserId),
      label: parsed.data.label,
      profile,
    });
  } catch (err) {
    console.error("Create client failed:", err);
    return NextResponse.json(
      { error: "Couldn't add that client. Please try again." },
      { status: 500, ...NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, clientUserId }, NO_STORE);
}
