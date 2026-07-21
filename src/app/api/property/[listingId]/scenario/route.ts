// Scenario Studio backend: model any financing / assumption overrides against a
// snapshotted listing WITHOUT touching the saved profile. Pure engine math on
// persisted RentCast payloads — no LLM, no external calls, no writes.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { AssumptionsSchema, FinancingProfileSchema } from "@/lib/profile-schema";
import { listingIdFromParam } from "@/lib/listing-param";
import {
  project,
  toIncomeInput,
  toPropertyInput,
  underwrite,
  type FinancingProfile,
  type IncomeInput,
} from "@/osprey/engine";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

const ScenarioSchema = z.object({
  financing: FinancingProfileSchema,
  assumptions: AssumptionsSchema.optional(),
  rentOverride: z.number().min(0).max(1_000_000).optional(),
  projectionYears: z.number().int().min(1).max(40).optional(),
  /** Added to cash-to-close and folded into cash-on-cash below — a rehab
   *  budget isn't part of the engine's UnderwriteInput (it's a scenario
   *  overlay, not a property/financing fact), so it's applied here rather
   *  than threaded through underwrite(). */
  rehabBudget: z.number().min(0).max(1_000_000).optional(),
});

export async function POST(
  req: NextRequest,
  ctx: { params: Promise<{ listingId: string }> },
) {
  const listingId = listingIdFromParam((await ctx.params).listingId);

  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  if (!hasDb()) {
    return NextResponse.json(
      { error: "Modeling is temporarily unavailable. Please try again later." },
      { status: 503, ...NO_STORE },
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = ScenarioSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Those scenario inputs don't look right." },
      { status: 400, ...NO_STORE },
    );
  }

  const store = new PgStore();

  // Authorization: you can only model properties from your own feed.
  const verdict = await store.loadVerdictForListing(userId, listingId);
  if (!verdict) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, ...NO_STORE });
  }

  const snapshot = await store.loadSnapshot(listingId);
  if (!snapshot) {
    // Listing predates snapshots — nothing to re-underwrite.
    return NextResponse.json({ error: "no_snapshot" }, { status: 404, ...NO_STORE });
  }

  const property = toPropertyInput(snapshot.listing);
  if (!property) {
    return NextResponse.json({ error: "not_underwritable" }, { status: 422, ...NO_STORE });
  }

  const { financing, assumptions, rentOverride, projectionYears, rehabBudget } = parsed.data;

  // rentOverride replaces monthly rent with a user-entered ('manual') figure;
  // otherwise use the snapshotted AVM estimate.
  let income: IncomeInput | null;
  if (rentOverride != null) {
    income = { rent: { monthlyRent: rentOverride, source: "manual" } };
  } else {
    income = snapshot.rent ? toIncomeInput(snapshot.rent) : null;
  }
  if (!income) {
    return NextResponse.json({ error: "no_rent" }, { status: 422, ...NO_STORE });
  }

  // Merge scenario assumption overrides over the user's profile assumptions.
  const profile = await store.loadProfile(userId);
  const mergedAssumptions = { ...profile?.assumptions, ...assumptions };

  const underwriting = underwrite({
    property,
    income,
    financing: financing as FinancingProfile,
    assumptions: mergedAssumptions,
  });
  const projection = project(underwriting, projectionYears ?? 30);

  // Rehab overlay: same cash-on-cash formula underwrite() uses internally
  // (annualCashFlow / cashToClose), just against a cash-to-close that
  // includes the rehab budget. Equals the base figures when rehabBudget is
  // 0/omitted, so callers can always read the "adjusted*" fields.
  const effectiveRehabBudget = rehabBudget ?? 0;
  const adjustedCashToClose = underwriting.cashToClose + effectiveRehabBudget;
  const adjustedCashOnCashPct =
    adjustedCashToClose > 0 ? (underwriting.annualCashFlow / adjustedCashToClose) * 100 : 0;

  return NextResponse.json(
    {
      underwriting,
      projection,
      rehabBudget: effectiveRehabBudget,
      adjustedCashToClose,
      adjustedCashOnCashPct,
    },
    NO_STORE,
  );
}
