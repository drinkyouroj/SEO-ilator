import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

/**
 * Next.js middleware protecting:
 * - /dashboard/* — redirect to /auth/sign-in if unauthenticated
 * - /api/* (except /api/auth/*, /api/cron/*, /api/health) — return 401 if unauthenticated
 *
 * Uses session cookie presence check. The actual session validation happens
 * in the API routes via requireAuth(). Middleware only does a lightweight
 * cookie check to prevent unnecessary round-trips for unauthenticated users.
 *
 * Note: Cannot use Auth.js auth() wrapper here because it imports the Prisma
 * adapter which requires Node.js pg module, incompatible with Edge runtime.
 */
export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth routes and cron routes through without checking session
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Allow health endpoint through (public monitoring)
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // Check for session cookie (Auth.js v5 database session cookie)
  // The cookie name follows Auth.js convention: authjs.session-token (or __Secure- prefix in production)
  const hasSession =
    request.cookies.has("authjs.session-token") ||
    request.cookies.has("__Secure-authjs.session-token");

  // Dashboard routes: redirect to sign-in
  if (pathname.startsWith("/dashboard")) {
    if (!hasSession) {
      const signInUrl = new URL("/auth/sign-in", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // API routes: return 401
  if (pathname.startsWith("/api/")) {
    if (!hasSession) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
