import { NextRequest, NextResponse } from "next/server";

const DEV_HOSTS = ["dev.getmeter.xyz", "getmeter.dev"];
const PROD_HOST = "getmeter.xyz";

function isDevHost(hostname: string) {
  return DEV_HOSTS.some((h) => hostname.startsWith(h.split(".")[0]));
}

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  // ── getmeter.dev routing ──────────────────────────────────────
  // Root → landing page. Console, docs, api, etc. pass through.
  if (isDevHost(hostname)) {
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
  if (hostname === PROD_HOST || hostname === "meter.chat") {
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
