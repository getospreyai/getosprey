// NOTE: Next.js 16 renamed the "middleware" file convention to "proxy" — see
// node_modules/next/dist/docs/01-app/03-api-reference/03-file-conventions/proxy.md.
// This file is the direct replacement for the old middleware.ts.
import { NextResponse } from "next/server";
import { auth } from "@/auth";

export default auth((req) => {
  if (!req.auth) {
    const loginUrl = new URL("/login", req.nextUrl.origin);
    return NextResponse.redirect(loginUrl);
  }
});

export const config = {
  matcher: ["/dashboard/:path*", "/settings/:path*"],
};
