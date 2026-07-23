// PUBLIC compute endpoint for the /try demo: pure engine math on
// visitor-supplied price/rent/type/financing. No auth, no DB, no RentCast,
// no external calls of any kind — this powers the interactive financing
// toggle on /try and costs nothing to run, so the zod bounds below are the
// only abuse guard. Do not import RentCast or pg-store from this file.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { FinancingProfileSchema, PropertyTypeSchema } from "@/lib/profile-schema";
import { dealProperty, rentIncome, DEMO_BAR } from "@/lib/demo-deals";
import { project, solveMaxOffer, underwrite, type FinancingProfile } from "@/osprey/engine";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

const TrySchema = z.object({
  price: z.number().min(10_000).max(100_000_000),
  rent: z.number().min(0).max(1_000_000),
  propertyType: PropertyTypeSchema,
  financing: FinancingProfileSchema,
  projectionYears: z.number().int().min(1).max(40).optional(),
  targetMonthlyCashFlow: z.number().min(-100_000).max(100_000).optional(),
});

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => null);
  const parsed = TrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Those numbers don't look right." },
      { status: 400, ...NO_STORE },
    );
  }

  const { price, rent, propertyType, financing, projectionYears, targetMonthlyCashFlow } = parsed.data;

  const property = dealProperty({ price, propertyType });
  const income = rentIncome({ rent });

  const underwriting = underwrite({ property, income, financing: financing as FinancingProfile });
  const projection = project(underwriting, projectionYears ?? 10);
  const maxOffer = solveMaxOffer({
    property,
    income,
    financing: financing as FinancingProfile,
    targetMonthlyCashFlow: targetMonthlyCashFlow ?? DEMO_BAR,
  });

  return NextResponse.json({ underwriting, projection, maxOffer }, NO_STORE);
}
