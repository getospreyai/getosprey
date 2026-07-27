// AI research reports are paused for the MVP relaunch — see
// src/osprey/reports/generate.ts header. This endpoint stays in place (auth
// check + 503) so the dashboard teaser and any stale client code get a
// well-known response instead of a 404.

import { NextResponse } from "next/server";
import { resolveRequestScope } from "@/lib/request-scope";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function POST() {
  const scoped = await resolveRequestScope();
  if (!scoped.ok && scoped.reason !== "no_db") {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  return NextResponse.json({ error: "coming_soon" }, { status: 503, ...NO_STORE });
}
