import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const PUBLIC_PATHS = ["/login", "/register", "/forgot-password"];
const SESSION_COOKIE_NAME = process.env.SESSION_COOKIE_NAME || "terminal_session";

/**
 * Optimistic check only — reads cookie presence, never touches the database.
 * The real, authoritative check happens in the Data Access Layer (see
 * lib/auth/dal.ts), which every protected Server Component/Route Handler calls.
 * See: https://nextjs.org/docs/app/guides/authentication#optimistic-checks-with-proxy-optional
 */
export default function proxy(request: NextRequest) {
  const { pathname } = request.nextUrl;
  const hasSessionCookie = Boolean(request.cookies.get(SESSION_COOKIE_NAME)?.value);
  const isPublicPath = PUBLIC_PATHS.includes(pathname);

  if (!isPublicPath && !hasSessionCookie) {
    return NextResponse.redirect(new URL("/login", request.url));
  }

  if (isPublicPath && hasSessionCookie) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  return NextResponse.next();
}

export const config = {
  // maplibre-gl-worker.mjs and its maplibre-gl-shared.mjs dependency (public/,
  // see WorldMap.tsx) are static library assets, not user data — same
  // category as the Next.js build assets below, so they're excluded from the
  // auth gate rather than depending on the request (issued by a Worker, not
  // the page itself) carrying the session cookie.
  //
  // /api/world-tracker/collect and /api/world-tracker/scan-zones are
  // machine-to-machine endpoints meant to be triggered by an external cron
  // pinger with no browser session at all — both have their own
  // shared-secret check (see those routes), so they're excluded here rather
  // than gated by the session cookie like every user-facing route.
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|maplibre-gl-worker.mjs|maplibre-gl-shared.mjs|api/world-tracker/collect|api/world-tracker/scan-zones).*)",
  ],
};
