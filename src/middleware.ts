import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

/**
 * Next.js middleware protecting:
 * - /dashboard/* — redirect to /auth/sign-in if unauthenticated
 * - /api/* (except /api/auth/*, /api/cron/*, /api/health) — return 401 if unauthenticated
 *
 * Uses Auth.js v5 `auth` wrapper which works with database sessions
 * (not `getToken` from next-auth/jwt which only works with JWT strategy).
 */
export default auth((req) => {
  const { pathname } = req.nextUrl;

  // Allow auth routes and cron routes through without checking session
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Allow health endpoint through (public monitoring)
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  const isAuthenticated = !!req.auth;

  // Dashboard routes: redirect to sign-in
  if (pathname.startsWith("/dashboard")) {
    if (!isAuthenticated) {
      const signInUrl = new URL("/auth/sign-in", req.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // API routes: return 401
  if (pathname.startsWith("/api/")) {
    if (!isAuthenticated) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
});

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
