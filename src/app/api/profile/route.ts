// Settings save endpoint. Only the fields the settings UI exposes are
// accepted; id/name/telegramChatId/tasteNotes always come from the stored
// profile — the client can never touch them (zod strips unknown keys, and
// the merge below only reads the specific fields it allows).

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { auth } from "@/auth";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import type { InvestorProfile } from "@/osprey/agent/model";

const PropertyTypeSchema = z.enum(["single_family", "duplex", "triplex", "fourplex"]);

const ConventionalSchema = z.object({
  kind: z.literal("conventional"),
  label: z.string().max(80).optional(),
  rate: z.number().min(0).max(0.2),
  downPct: z.number().min(0).max(1),
  termYears: z.number().min(1).max(40).optional(),
  pmiAnnualPct: z.number().min(0).max(0.1).optional(),
});

const FhaSchema = z.object({
  kind: z.literal("fha"),
  label: z.string().max(80).optional(),
  rate: z.number().min(0).max(0.2),
  downPct: z.number().min(0).max(1).optional(),
  termYears: z.number().min(1).max(40).optional(),
  ufmipPct: z.number().min(0).max(0.1).optional(),
  financeUfmip: z.boolean().optional(),
  annualMipPct: z.number().min(0).max(0.1).optional(),
  ownerOccupiedUnit: z.number().min(1).max(4).optional(),
});

const DscrSchema = z.object({
  kind: z.literal("dscr"),
  label: z.string().max(80).optional(),
  rate: z.number().min(0).max(0.2),
  downPct: z.number().min(0).max(1),
  termYears: z.number().min(1).max(40).optional(),
  interestOnly: z.boolean().optional(),
  minDscr: z.number().min(0).max(3).optional(),
});

const CashSchema = z.object({
  kind: z.literal("cash"),
  label: z.string().max(80).optional(),
});

const FinancingProfileSchema = z.discriminatedUnion("kind", [
  ConventionalSchema,
  FhaSchema,
  DscrSchema,
  CashSchema,
]);

const PatchProfileSchema = z.object({
  buyBox: z.object({
    cities: z.array(z.string().min(1).max(80)).max(50),
    minPrice: z.number().min(0).max(100_000_000).nullable(),
    maxPrice: z.number().min(0).max(100_000_000).nullable(),
    propertyTypes: z.array(PropertyTypeSchema).min(1),
    maxDaysOnMarket: z.number().min(0).max(3650).nullable(),
  }),
  minMonthlyCashFlow: z.number().min(-100_000).max(100_000),
  alertsPaused: z.boolean(),
  financingProfiles: z.array(FinancingProfileSchema).min(1),
});

export async function PATCH(req: NextRequest) {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  if (!hasDb()) {
    return NextResponse.json(
      { error: "Settings are temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some of those settings don't look right." },
      { status: 400 }
    );
  }
  const data = parsed.data;

  const store = new PgStore();
  const stored = await store.loadProfile(userId);
  if (!stored) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const merged: InvestorProfile = {
    ...stored,
    buyBox: {
      ...stored.buyBox,
      cities: data.buyBox.cities,
      minPrice: data.buyBox.minPrice ?? undefined,
      maxPrice: data.buyBox.maxPrice ?? undefined,
      propertyTypes: data.buyBox.propertyTypes,
      maxDaysOnMarket: data.buyBox.maxDaysOnMarket ?? undefined,
    },
    minMonthlyCashFlow: data.minMonthlyCashFlow,
    alertsPaused: data.alertsPaused,
    financingProfiles: data.financingProfiles,
  };

  await store.saveProfile(merged);

  return NextResponse.json(merged);
}
