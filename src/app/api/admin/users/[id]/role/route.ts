// Promote a user to agent, or demote them back to investor.
//
// This route is the reason the whole admin surface exists: until it shipped,
// granting `role = 'agent'` was a manual UPDATE against production, so agent
// accounts had no users no matter how much of the feature was built.
//
// Authorization is `requireAdmin()` and nothing else. As with the agent routes,
// no role check, no branch on the session — the env allowlist is the whole
// decision, re-read on every request.
//
// Every refusal is a 404 with the same body: a signed-in non-admin must not be
// able to tell that this endpoint exists.

import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/require-admin";
import { adminUiEnabled } from "@/lib/features";
import { isAssignableRole } from "@/lib/admin-actions";
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
    // 'unauthenticated' and 'not_admin' answer identically.
    return refuse();
  }

  const { id } = await params;
  const body = await req.json().catch(() => null);
  const role = (body as { role?: unknown } | null)?.role;

  if (!isAssignableRole(role)) {
    return NextResponse.json(
      { error: "Role must be 'investor' or 'agent'." },
      { status: 400, ...NO_STORE },
    );
  }

  const store = new PgStore();
  // The self-action guard and the audit write both live inside this call — see
  // the note above PgStore.adminSetUserRole. A false return means the WHERE
  // clause matched nothing: no such user, already that role, or the operator
  // aiming at their own account.
  const changed = await store.adminSetUserRole({
    actorEmail: admin.email,
    targetUserId: id,
    role,
  });

  if (!changed) {
    return NextResponse.json(
      {
        error:
          "Nothing changed — the account may not exist, may already have that role, or may be your own.",
      },
      { status: 409, ...NO_STORE },
    );
  }

  return NextResponse.json({ ok: true, role }, NO_STORE);
}
