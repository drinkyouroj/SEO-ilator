import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { getToken } from "next-auth/jwt";

/**
 * Next.js middleware protecting:
 * - /dashboard/* -- redirect to /auth/sign-in if unauthenticated
 * - /api/* (except /api/auth/*, /api/cron/*, /api/health) -- return 401 if unauthenticated
 */
export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  // Allow auth routes and cron routes through without checking session
  if (pathname.startsWith("/api/auth/") || pathname.startsWith("/api/cron/")) {
    return NextResponse.next();
  }

  // Allow health endpoint through (public monitoring)
  if (pathname === "/api/health") {
    return NextResponse.next();
  }

  // Check for authenticated session
  const token = await getToken({
    req: request,
    secret: process.env.AUTH_SECRET,
  });

  // Dashboard routes: redirect to sign-in
  if (pathname.startsWith("/dashboard")) {
    if (!token) {
      const signInUrl = new URL("/auth/sign-in", request.url);
      signInUrl.searchParams.set("callbackUrl", pathname);
      return NextResponse.redirect(signInUrl);
    }
    return NextResponse.next();
  }

  // API routes: return 401
  if (pathname.startsWith("/api/")) {
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/dashboard/:path*", "/api/:path*"],
};
