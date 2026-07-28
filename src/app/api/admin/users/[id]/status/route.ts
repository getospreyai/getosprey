// Suspend or reactivate an account.
//
// Suspension is the first revocation path the product has ever had that acts on
// a live session. It works because `canActAsViewer()` allowlists only 'active'
// (src/lib/auth-guard.ts): the moment `status` becomes 'suspended', the target's
// existing JWT stops describing an account allowed to act, and their very next
// request is refused. The token is still cryptographically valid — we do not
// invalidate sessions, we invalidate the account behind them — so there is no
// session store to purge and no window to wait out.
//
// Same authorization and same refusal discipline as the role route.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { adminUiEnabled } from "@/lib/features";
import { isAssignableStatus } from "@/lib/admin-actions";
import { PgStore } from "@/osprey/pg-store";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

function refuse() {
  return NextResponse.json({ error: "not_found" }, { status: 404, ...NO_STORE });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  if (!adminUiEnabled()) return refuse();

  const admin = await requireAdmin();
  if (!admin.ok) {
    if (admin.reason === "no_db") {
      return NextResponse.json(
        { error: "Temporarily unavailable." },
        { status: 503, ...NO_STORE },
      );
    }
    return refuse();
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const status = (body as { status?: unknown } | null)?.status;

  if (!isAssignableStatus(status)) {
    return NextResponse.json(
      { error: "Status must be 'active' or 'suspended'." },
      { status: 400, ...NO_STORE },
    );
  }

  const store = new PgStore();
  // Guardrail #1 is enforced in the WHERE clause: an operator cannot suspend
  // the account they are signed in as. Doing so would revoke their own session
  // on the next request, and the only tool that could undo it is this one.
  const changed = await store.adminSetUserStatus({
    actorEmail: admin.email,
    targetUserId: id,
    status,
  });

  if (!changed) {
    return NextResponse.json(
      {
        error:
          "Nothing changed — the account may not exist, may already be in that state, may be your own, or may be an agent-managed client that cannot sign in anyway.",
      },
      { status: 409, ...NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, status }, NO_STORE);
}
