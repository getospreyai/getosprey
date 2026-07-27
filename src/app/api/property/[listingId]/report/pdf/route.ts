// Download the cached research report as a branded PDF. Renders the stored
// report JSON deterministically (no LLM) — 404s when no ready report exists.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestScope } from "@/lib/request-scope";
import { ReportSchema } from "@/osprey/reports/generate";
import { reportToPdf } from "@/osprey/reports/pdf";
import { listingIdFromParam } from "@/lib/listing-param";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET(
  _req: NextRequest,
  ctx: { params: Promise<{ listingId: string }> },
) {
  const listingId = listingIdFromParam((await ctx.params).listingId);

  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Reports are temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const { store } = scoped;

  const row = await store.getReport(listingId);
  if (!row || row.status !== "ready" || !row.report) {
    return NextResponse.json({ error: "no_report" }, { status: 404, ...NO_STORE });
  }
  const parsed = ReportSchema.safeParse(row.report);
  if (!parsed.success) {
    return NextResponse.json({ error: "no_report" }, { status: 404, ...NO_STORE });
  }

  const snapshot = await store.loadSnapshot(listingId);
  const profile = await store.loadProfile();
  const address =
    snapshot?.listing.formattedAddress ??
    snapshot?.listing.addressLine1 ??
    "Property report";

  const bytes = await reportToPdf(parsed.data, {
    address,
    preparedBy: profile?.name ?? "Osprey",
  });

  const filename = `osprey-report-${listingId}.pdf`;
  return new NextResponse(bytes as BodyInit, {
    status: 200,
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store, max-age=0",
    },
  });
}
