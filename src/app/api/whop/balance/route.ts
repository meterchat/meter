import { NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";

// Platform balance — Whop handles payouts via their dashboard.
// This endpoint is kept for dashboard compatibility but returns a placeholder.
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  return NextResponse.json({
    balance: {
      available: [],
      pending: [],
    },
    recentPayouts: [],
    note: "Platform balance and payouts are managed via the Whop dashboard.",
  });
}
