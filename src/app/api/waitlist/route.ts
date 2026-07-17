import { NextRequest, NextResponse } from "next/server";
import { neon } from "@neondatabase/serverless";

const PHONE_RE = /^\+?[0-9()\-.\s]{7,20}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? "";

// Reuse the SQL client across warm invocations.
const sql = connectionString ? neon(connectionString) : null;

// Ensure the table exists once per cold start.
let schemaReady = false;
async function ensureSchema(db: ReturnType<typeof neon>) {
  if (schemaReady) return;
  await db`
    CREATE TABLE IF NOT EXISTS waitlist (
      id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      name        TEXT NOT NULL,
      email       TEXT NOT NULL,
      phone       TEXT,
      created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )
  `;
  await db`
    CREATE UNIQUE INDEX IF NOT EXISTS waitlist_email_unique
      ON waitlist (lower(email))
  `;
  schemaReady = true;
}

export async function POST(req: NextRequest) {
  if (!sql) {
    console.error("Waitlist: DATABASE_URL is not configured.");
    return NextResponse.json(
      { error: "Waitlist is temporarily unavailable. Please try again later." },
      { status: 503 }
    );
  }

  const body = await req.json().catch(() => null);
  const name = typeof body?.name === "string" ? body.name.trim() : "";
  const email = typeof body?.email === "string" ? body.email.trim() : "";
  const phone = typeof body?.phone === "string" ? body.phone.trim() : "";

  if (!name) {
    return NextResponse.json({ error: "Enter your name." }, { status: 400 });
  }
  if (!email) {
    return NextResponse.json(
      { error: "Enter your email address." },
      { status: 400 }
    );
  }
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json(
      { error: "That email doesn't look right." },
      { status: 400 }
    );
  }
  if (phone && !PHONE_RE.test(phone)) {
    return NextResponse.json(
      { error: "That phone number doesn't look right." },
      { status: 400 }
    );
  }

  try {
    await ensureSchema(sql);
    const rows = await sql`
      INSERT INTO waitlist (name, email, phone)
      VALUES (${name}, ${email}, ${phone || null})
      ON CONFLICT (lower(email)) DO NOTHING
      RETURNING id
    `;
    // rows is empty when the email is already on the list — treat as success.
    const duplicate = rows.length === 0;
    return NextResponse.json({ ok: true, duplicate });
  } catch (err) {
    console.error("Waitlist insert failed:", err);
    return NextResponse.json(
      { error: "Something went wrong. Please try again." },
      { status: 500 }
    );
  }
}
