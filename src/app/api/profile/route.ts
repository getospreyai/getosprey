// Settings save/read endpoint. Only the fields the settings UI exposes are
// accepted; id/name/telegramChatId always come from the stored profile — the
// client can never touch them (zod strips unknown keys, and the merge below
// only reads the specific fields it allows). dealbreakers/tasteNotes are
// user-editable but optional in the payload (see profile-schema.ts). Schema +
// merge logic live in src/lib/profile-schema.ts, shared with the onboarding
// wizard.

import { NextRequest, NextResponse } from "next/server";
import { resolveRequestScope } from "@/lib/request-scope";
import { PatchProfileSchema, mergeProfileSettings } from "@/lib/profile-schema";
import { enforceFarmOnBuyBoxWrite } from "@/lib/farm-enforcement";
import { agentAccountsEnabled } from "@/lib/features";
import { POLICY_VERSION } from "@/lib/legal";
import { PgStore } from "@/osprey/pg-store";

// The onboarding wizard polls GET to detect the Telegram binding — the
// response must never be cached anywhere along the way.
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET() {
  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Settings are temporarily unavailable. Please try again later." },
        { status: 503 }
      );
    }
    // `forbidden` here means the viewer's own account was revoked after their
    // JWT was issued — same 401 as never having been signed in.
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  const { store } = scoped;
  const profile = await store.loadProfile();
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404, ...NO_STORE });
  }

  return NextResponse.json(profile, NO_STORE);
}

export async function PATCH(req: NextRequest) {
  const scoped = await resolveRequestScope();
  if (!scoped.ok) {
    if (scoped.reason === "no_db") {
      return NextResponse.json(
        { error: "Settings are temporarily unavailable. Please try again later." },
        { status: 503 }
      );
    }
    return NextResponse.json({ error: "Unauthorized." }, { status: 401 });
  }

  const body = await req.json().catch(() => null);
  const parsed = PatchProfileSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Some of those settings don't look right." },
      { status: 400 }
    );
  }

  const { store } = scoped;
  const stored = await store.loadProfile();
  if (!stored) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const merged = mergeProfileSettings(stored, parsed.data);

  // The farm rule. Before Phase 2 this route could not affect an agent
  // relationship, because every agent-sourced buy box was written by the
  // agent. A claimed client edits their own, here, and moving it outside
  // their agent's farm ends the relationship — see src/lib/farm-enforcement.ts
  // for why that rather than refusing the edit.
  //
  // Runs BEFORE the save so an out-of-farm buy box never exists under a live
  // agent link, and returns null immediately for anyone without an agent,
  // which is every user in the product today.
  const disconnected = agentAccountsEnabled()
    ? await enforceFarmOnBuyBoxWrite(scoped.scope.subjectId, merged.buyBox, new PgStore(), POLICY_VERSION)
    : null;

  // Settings-only write: never touches telegram_chat_id, so a save racing a
  // fresh /start binding can't clobber the connection.
  await store.saveProfileSettings(merged);

  // The notice rides back on the write that caused it, so the UI can say what
  // happened while the user is still looking at the screen. A silent
  // disconnect is the one outcome this design rules out.
  return NextResponse.json(
    disconnected ? { ...merged, agentDisconnected: disconnected } : merged,
    NO_STORE,
  );
}
