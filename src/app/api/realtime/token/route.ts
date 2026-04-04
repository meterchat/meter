// src/app/api/realtime/token/route.ts
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireAuth } from "@/lib/auth";

// GET /api/realtime/token — mint a short-lived JWT for Supabase Realtime.
// The browser calls this on page load and every 50 minutes to refresh.
// The JWT contains the user's ID so Supabase RLS policies can filter
// Realtime events to only this user's data.
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SUPABASE_JWT_SECRET not configured" },
      { status: 500 },
    );
  }

  const key = new TextEncoder().encode(secret);

  const token = await new SignJWT({
    sub: userId,
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  return NextResponse.json({ token });
}
