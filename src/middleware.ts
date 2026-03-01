import { NextRequest, NextResponse } from "next/server";

const DEV_HOSTS = new Set(["dev.getmeter.xyz", "getmeter.dev", "www.getmeter.dev"]);
const PROD_HOSTS = new Set(["getmeter.xyz", "meter.chat", "www.meter.chat"]);

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  // ── getmeter.dev routing ──────────────────────────────────────
  // Root → landing page. Console, docs, api, etc. pass through.
  // Strip port for local dev (e.g. "localhost:3000" → "localhost")
  const host = hostname.split(":")[0];

  if (DEV_HOSTS.has(host)) {
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = "/landing";
      return NextResponse.rewrite(url);
    }
    // /console, /docs, /api/* all pass through to their actual routes
    return NextResponse.next();
  }

  // ── Production domain (getmeter.xyz / meter.chat) ─────────────
  // Block /console and /landing on production domain
  if (PROD_HOSTS.has(host)) {
    if (pathname.startsWith("/console") || pathname.startsWith("/landing")) {
      const url = req.nextUrl.clone();
      url.pathname = "/";
      return NextResponse.redirect(url);
    }
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
