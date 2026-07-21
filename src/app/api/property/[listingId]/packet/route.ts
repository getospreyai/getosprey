// Lender deal-packet PDF download. Deterministic (no LLM) — reuses the same
// solver/stress/comps bundle (lib/property-insights.ts) the property page
// renders, so the packet always matches what's on screen. Auth'd +
// verdict-ownership gated, same pattern as the scenario/share routes.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { bestUnderwriting } from "@/lib/best-underwriting";
import { computePropertyInsights } from "@/lib/property-insights";
import { listingIdFromParam } from "@/lib/listing-param";
import { project, toIncomeInput, toPropertyInput } from "@/osprey/engine";
import { dealPacketPdf } from "@/osprey/reports/packet";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(
  _req: NextRequest,
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
      { error: "Packets are temporarily unavailable. Please try again later." },
      { status: 503, ...NO_STORE },
    );
  }

  const store = new PgStore();

  // Authorization: you can only pull a packet for a property from your own feed.
  const verdict = await store.loadVerdictForListing(userId, listingId);
  if (!verdict) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, ...NO_STORE });
  }

  const [snapshot, profile] = await Promise.all([
    store.loadSnapshot(listingId),
    store.loadProfile(userId),
  ]);
  if (!snapshot) {
    return NextResponse.json({ error: "no_snapshot" }, { status: 404, ...NO_STORE });
  }

  const property = toPropertyInput(snapshot.listing);
  const income = snapshot.rent ? toIncomeInput(snapshot.rent) : null;
  const uw = property && income && profile ? bestUnderwriting(property, income, profile) : null;
  if (!property || !income || !uw) {
    return NextResponse.json({ error: "not_underwritable" }, { status: 422, ...NO_STORE });
  }

  const projection = project(uw, 30);
  const bar = profile?.minMonthlyCashFlow ?? 0;
  const insights = computePropertyInsights({
    property,
    income,
    uw,
    bar,
    bedrooms: snapshot.listing.bedrooms,
    rawComparables: snapshot.rent?.comparables,
  });

  const address =
    snapshot.listing.formattedAddress ?? snapshot.listing.addressLine1 ?? verdict.address;

  const bytes = await dealPacketPdf({
    address,
    preparedBy: profile?.name ?? "Osprey",
    uw,
    projection,
    rent: income.rent,
    comparables: insights.comparables,
    maxOffer: insights.maxOffer,
    clearingRate: insights.clearingRate,
    section8: insights.section8,
    bar,
    daysOnMarket: snapshot.listing.daysOnMarket,
  });

  const safeId = listingId.replace(/[^a-zA-Z0-9-]+/g, "-");
  const filename = `osprey-packet-${safeId}.pdf`;
  return new NextResponse(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
