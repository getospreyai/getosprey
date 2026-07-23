import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { sql, ensureSchema, hasDb } from "@/lib/db";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface PgError {
  code?: string;
}

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as PgError).code === "23505";
}

function defaultProfile(userId: string, name: string) {
  return {
    id: userId,
    name,
    onboarded: false,
    buyBox: {
      states: [],
      cities: [],
      propertyTypes: [],
    },
    financingProfiles: [],
    minMonthlyCashFlow: 0,
  };
}

export async function POST(req: NextRequest) {
  if (!hasDb() || !sql) {
    console.error("Signup: DATABASE_URL is not configured.");
    return NextResponse.json(
      { error: "Signup is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);

  // Pre-launch gate: signups are invite-only. With SIGNUP_INVITE_CODE unset,
  // signups are closed entirely; delete the env var at public launch.
  const inviteRequired = process.env.SIGNUP_INVITE_CODE;
  const inviteGiven =
    typeof body?.inviteCode === "string" ? body.inviteCode.trim() : "";
  if (!inviteRequired || inviteGiven !== inviteRequired) {
    return NextResponse.json(
      {
        error:
          "Osprey is invite-only right now — join the waitlist at getosprey.ai and we'll reach out.",
      },
      { status: 403 }
    );
  }
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const emailRaw = typeof body?.email === "string" ? body.email.trim() : "";
  const email = emailRaw.toLowerCase();
  const password = typeof body?.password === "string" ? body.password : "";

  if (!name) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (!email || !EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "Enter a valid email address." },
      { status: 400 }
    );
  }
  if (password.length < 8) {
    return NextResponse.json(
      { error: "Password must be at least 8 characters." },
      { status: 400 }
    );
  }

  try {
    await ensureSchema();

    const userId = crypto.randomUUID();
    const passwordHash = await bcrypt.hash(password, 10);
    const profile = defaultProfile(userId, name);

    await sql.transaction([
      sql`
        INSERT INTO users (id, email, password_hash, name)
        VALUES (${userId}, ${email}, ${passwordHash}, ${name})
      `,
      sql`
        INSERT INTO investor_profiles (user_id, profile)
        VALUES (${userId}, ${JSON.stringify(profile)}::jsonb)
      `,
    ]);

    return NextResponse.json({ ok: true });
  } catch (err) {
    if (isUniqueViolation(err)) {
      return NextResponse.json(
        { error: "An account with that email already exists." },
        { status: 409 }
      );
    }
    console.error("Signup failed:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
