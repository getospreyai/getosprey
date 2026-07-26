import type { DefaultSession } from "next-auth";

declare module "next-auth" {
  interface Session {
    user: {
      id: string;
      /** 'investor' | 'agent' | 'brokerage_admin'.
       *
       *  NAVIGATION AND UI ONLY. Captured at sign-in, so it goes stale as soon
       *  as the role changes in the database. Authorization must never read
       *  this — use resolveScope(), which re-reads on every access. */
      role: string;
    } & DefaultSession["user"];
  }

  interface User {
    role?: string;
  }
}

declare module "next-auth/jwt" {
  interface JWT {
    id?: string;
    /** See Session.user.role — nav only, never authorization. */
    role?: string;
  }
}
