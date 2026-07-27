import NextAuth from "next-auth";
import Credentials from "next-auth/providers/credentials";
import bcrypt from "bcryptjs";
import { sql, ensureSchema, hasDb } from "@/lib/db";
import { canAuthenticate } from "@/lib/auth-guard";

/** A well-formed bcrypt digest (cost 10, matching signup's) compared against
 *  when no login is possible, so the failure path costs roughly what a real
 *  one does.
 *
 *  Its RESULT IS DISCARDED AND MUST STAY THAT WAY — that, not any property of
 *  this particular string, is what makes it safe. The surrounding branch
 *  returns null unconditionally. Never write `if (await bcrypt.compare(...))`
 *  against this value: doing so would turn a timing-equalization no-op into an
 *  authentication bypass. */
const DUMMY_HASH = "$2b$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy";

export const { handlers, auth, signIn, signOut } = NextAuth({
  session: { strategy: "jwt" },
  pages: {
    signIn: "/login",
  },
  providers: [
    Credentials({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        const email =
          typeof credentials?.email === "string"
            ? credentials.email.trim().toLowerCase()
            : "";
        const password =
          typeof credentials?.password === "string" ? credentials.password : "";

        if (!email || !password || !hasDb() || !sql) return null;

        await ensureSchema();
        const rows = await sql`
          SELECT id, email, password_hash, name, role, status FROM users WHERE email = ${email}
        `;
        const user = rows[0] as
          | {
              id: string;
              email: string;
              password_hash: string | null;
              name: string;
              role: string | null;
              status: string | null;
            }
          | undefined;

        // Managed/invited clients (null password_hash) must never authenticate.
        // This MUST come before bcrypt.compare: bcryptjs throws on a non-string
        // digest rather than returning false. See src/lib/auth-guard.ts.
        if (!user || !canAuthenticate(user)) {
          // Burn a comparison anyway so "no such user" and "wrong password"
          // take similar time. Returning early on a missing user is a classic
          // account-enumeration oracle, and adding the guard above would have
          // widened it to also reveal which accounts are agent-managed.
          await bcrypt.compare(password, DUMMY_HASH).catch(() => false);
          return null;
        }

        const valid = await bcrypt.compare(password, user.password_hash as string);
        if (!valid) return null;

        return {
          id: user.id,
          email: user.email,
          name: user.name,
          role: user.role ?? "investor",
        };
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        token.role = user.role ?? "investor";
      }
      return token;
    },
    async session({ session, token }) {
      if (session.user) {
        // Assigned unconditionally: next-auth.d.ts declares `role` as a
        // required string, so leaving it unset on a token missing `id` would
        // hand callers a value TypeScript guarantees but that is undefined at
        // runtime.
        session.user.role = typeof token.role === "string" ? token.role : "investor";
      }
      if (session.user && typeof token.id === "string") {
        session.user.id = token.id;
        // NAVIGATION ONLY. This is a snapshot taken at sign-in and goes stale
        // the moment a role changes — a user promoted to agent keeps an
        // 'investor' token until they re-authenticate, and a demoted one keeps
        // 'agent'. Never make an authorization decision from it; resolveScope()
        // re-reads the database on every cross-user access. See
        // docs/AGENT-ACCOUNTS-PLAN.md §3a T5.
      }
      return session;
    },
  },
});
