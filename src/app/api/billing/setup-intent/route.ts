import { NextRequest, NextResponse } from "next/server";
import { getWhop, WHOP_COMPANY_ID } from "@/lib/whop";
import { requireAuth } from "@/lib/auth";

// POST /api/billing/setup-intent — create Whop checkout config for saving a card
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const whop = getWhop();
    const config = await whop.checkoutConfigurations.create({
      company_id: WHOP_COMPANY_ID,
      mode: "setup",
      redirect_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/confirm-redirect`,
      metadata: { meter_user_id: userId },
    });

    return NextResponse.json({
      sessionId: config.id,
      purchaseUrl: config.purchase_url,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Setup intent error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
