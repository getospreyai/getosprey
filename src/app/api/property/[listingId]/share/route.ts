// Public share link management. POST mints (or returns) a read-only token a
// realtor forwards to a client; DELETE revokes it. Auth'd, verdict-ownership
// gated — you only share properties from your own feed.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestScope } from "@/lib/request-scope";
import { listingIdFromParam } from "@/lib/listing-param";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function POST(
  _req: NextRequest,
  ctx: { params: Promise<{ listingId: string }> },
) {
  const listingId = listingIdFromParam((await ctx.params).listingId);

  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Sharing is temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const { store } = scoped;

  const verdict = await store.loadVerdictForListing(listingId);
  if (!verdict) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, ...NO_STORE });
  }

  const token = await store.createShareLink(listingId);
  return NextResponse.json({ url: `/r/${token}` }, NO_STORE);
}

export async function DELETE(
  _req: NextRequest,
  ctx: { params: Promise<{ listingId: string }> },
) {
  const listingId = listingIdFromParam((await ctx.params).listingId);

  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Sharing is temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const { store } = scoped;

  const verdict = await store.loadVerdictForListing(listingId);
  if (!verdict) {
    return NextResponse.json({ error: "forbidden" }, { status: 403, ...NO_STORE });
  }

  await store.revokeShareLink(listingId);
  return NextResponse.json({ ok: true }, NO_STORE);
}
