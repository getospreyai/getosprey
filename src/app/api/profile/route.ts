// Settings save/read endpoint. Only the fields the settings UI exposes are
// accepted; id/name/telegramChatId always come from the stored profile — the
// client can never touch them (zod strips unknown keys, and the merge below
// only reads the specific fields it allows). dealbreakers/tasteNotes are
// user-editable but optional in the payload (see profile-schema.ts). Schema +
// merge logic live in src/lib/profile-schema.ts, shared with the onboarding
// wizard.

import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/auth";
import { hasDb } from "@/lib/db";
import { PgStore } from "@/osprey/pg-store";
import { PatchProfileSchema, mergeProfileSettings } from "@/lib/profile-schema";

// The onboarding wizard polls GET to detect the Telegram binding — the
// response must never be cached anywhere along the way.
export const dynamic = "force-dynamic";

const NO_STORE = { headers: { "Cache-Control": "no-store, max-age=0" } };

export async function GET() {
  const session = await auth();
  const userId = session?.user?.id;
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized." }, { status: 401, ...NO_STORE });
  }

  if (!hasDb()) {
    return NextResponse.json(
      { error: "Settings are temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  const store = new PgStore();
  const profile = await store.loadProfile(userId);
  if (!profile) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404, ...NO_STORE });
  }

  return NextResponse.json(profile, NO_STORE);
}

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

  const store = new PgStore();
  const stored = await store.loadProfile(userId);
  if (!stored) {
    return NextResponse.json({ error: "Profile not found." }, { status: 404 });
  }

  const merged = mergeProfileSettings(stored, parsed.data);

  // Settings-only write: never touches telegram_chat_id, so a save racing a
  // fresh /start binding can't clobber the connection.
  await store.saveProfileSettings(merged);

  return NextResponse.json(merged, NO_STORE);
}
