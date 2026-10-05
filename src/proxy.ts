import { NextResponse, type NextRequest } from "next/server";
import { authConfig, SESSION_COOKIE, verifySessionToken } from "@/lib/auth-token";

/**
 * First line of defense: every page, API route and server action requires a session.
 * getCurrentUser() re-checks the session, so a matcher mistake can't expose data.
 */
export function proxy(request: NextRequest) {
  const cfg = authConfig();
  if (cfg.mode === "open") return NextResponse.next();
  const authed = cfg.mode === "password" && verifySessionToken(request.cookies.get(SESSION_COOKIE)?.value, cfg);
  if (authed) return NextResponse.next();
  if (request.nextUrl.pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Not signed in" }, { status: 401 });
  }
  const login = new URL("/login", request.url);
  const next = request.nextUrl.pathname + request.nextUrl.search;
  if (next !== "/") login.searchParams.set("next", next);
  return NextResponse.redirect(login);
}

export const config = {
  matcher: ["/((?!login|_next/static|_next/image|favicon.ico|robots.txt|apple-icon|manifest.webmanifest).*)"],
};
