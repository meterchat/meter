import { NextResponse } from "next/server";

// Serves the Apple Pay domain association file.
// Rewritten from /.well-known/apple-developer-merchantid-domain-association
// via next.config.ts to avoid domain-level redirects that break Apple's verification.
const ASSOCIATION = '{"version":1,"pspId":"646A8BB624914FB2E855B9D516FB5503381A2DDF85EAFCF60236D80A0DCB53F2","createdOn":1760664777432}';

export async function GET() {
  return new NextResponse(ASSOCIATION, {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "public, max-age=86400",
    },
  });
}
