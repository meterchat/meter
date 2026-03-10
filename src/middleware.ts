import { NextRequest, NextResponse } from "next/server";

const DEV_HOSTS = ["dev.getmeter.xyz", "getmeter.dev"];
const PROD_HOST = "getmeter.xyz";
const LOG_HOST = "log.meter.chat";
const DOCS_HOST = "docs.meter.chat";

export function middleware(req: NextRequest) {
  const hostname = req.headers.get("host") ?? "";
  const { pathname } = req.nextUrl;

  // docs.meter.chat/{handle}/{workspace} → rewrite to /docs/{handle}/{workspace}
  if (hostname === DOCS_HOST || hostname.startsWith("docs.meter")) {
    if (!pathname.startsWith("/docs") && !pathname.startsWith("/api") && !pathname.startsWith("/_next") && !pathname.startsWith("/favicon")) {
      const url = req.nextUrl.clone();
      url.pathname = `/docs${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  // log.meter.chat → rewrite to /log
  if (hostname === LOG_HOST || hostname.startsWith("log.meter")) {
    if (!pathname.startsWith("/log") && !pathname.startsWith("/api") && !pathname.startsWith("/_next") && !pathname.startsWith("/favicon")) {
      const url = req.nextUrl.clone();
      url.pathname = `/log${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  // dev.getmeter.xyz → rewrite to /console
  if (DEV_HOSTS.some((h) => hostname.startsWith(h.split(".")[0]))) {
    if (!pathname.startsWith("/console") && !pathname.startsWith("/api") && !pathname.startsWith("/_next") && !pathname.startsWith("/favicon")) {
      const url = req.nextUrl.clone();
      url.pathname = `/console${pathname}`;
      return NextResponse.rewrite(url);
    }
  }

  // Block /console on production domain (keep demo & console separate)
  if (pathname.startsWith("/console") && hostname === PROD_HOST) {
    const url = req.nextUrl.clone();
    url.pathname = "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)"],
};
