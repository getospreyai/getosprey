// Agent-level settings: the farm markets that bound which buy boxes an agent
// may create for clients. Separate from /api/profile, which is the agent's own
// investing profile — an agent who never invests personally still needs these.

import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { resolveRequestScope } from "@/lib/request-scope";
import { agentAccountsEnabled } from "@/lib/features";
import { parseFarmMarkets, withinFarm } from "@/lib/farm-markets";
import { PgStore } from "@/osprey/pg-store";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

const FarmMarketsSchema = z.object({
  farmMarkets: z
    .array(
      z.object({
        city: z.string().trim().max(120).optional(),
        state: z.string().trim().min(2).max(2),
      }),
    )
    // Each market is a full paginated RentCast pull on every daily scan, so
    // the ceiling here is a real cost decision, not a form nicety. Keep it at
    // or below OSPREY_MAX_MARKETS.
    .max(5),
});

export async function GET() {
  if (!agentAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }
  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const store = new PgStore();
  const farmMarkets = parseFarmMarkets(await store.loadFarmMarkets(scoped.userId));
  return NextResponse.json({ farmMarkets }, NO_STORE);
}

export async function PATCH(req: NextRequest) {
  if (!agentAccountsEnabled()) {
    return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
  }
  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Settings are temporarily unavailable. Please try again later." },
        { status: 503, ...NO_STORE },
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const parsed = FarmMarketsSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Pick up to 5 markets, each with a 2-letter state." },
      { status: 400, ...NO_STORE },
    );
  }

  const store = new PgStore();
  const farmMarkets = parseFarmMarkets(parsed.data.farmMarkets);

  // Shrinking the farm must not strand existing clients: a client whose buy box
  // falls outside the new farm would keep being scanned (their profile is
  // unchanged) while the agent believes that market is no longer covered, and
  // the market-cap accounting the farm exists to bound would be wrong. Refuse
  // and name who blocks it.
  const clients = await store.listAgentClients(scoped.userId);
  const stranded = clients.filter(
    (c) => c.profile && !withinFarm(c.profile.buyBox, farmMarkets).ok,
  );
  if (stranded.length > 0) {
    return NextResponse.json(
      {
        error:
          `That would leave ${stranded.length} client(s) outside your farm: ` +
          `${stranded.map((c) => c.name).join(", ")}. Update or archive them first.`,
      },
      { status: 409, ...NO_STORE },
    );
  }

  await store.saveFarmMarkets(scoped.userId, farmMarkets);
  return NextResponse.json({ farmMarkets }, NO_STORE);
}
