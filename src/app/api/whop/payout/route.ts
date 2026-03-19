import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";

// Platform payout — Whop handles payouts via their dashboard.
// This endpoint is kept for dashboard compatibility but is a no-op.
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    error: "Payouts are managed via the Whop dashboard. This endpoint is deprecated.",
  }, { status: 410 });
}
