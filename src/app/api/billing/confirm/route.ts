import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/billing/confirm — called after Whop setup checkout completes
// The setup_intent.succeeded webhook is the primary handler, but this endpoint
// can be used as a fallback for manual confirmation with known payment method details.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { memberId, paymentMethodId, cardLast4, cardBrand } = await req.json();

    if (!memberId || !paymentMethodId) {
      return NextResponse.json({ error: "memberId and paymentMethodId required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    const last4 = cardLast4 ?? "0000";
    const brand = cardBrand ?? "unknown";

    await supabase
      .from("meter_users")
      .update({
        whop_member_id: memberId,
        whop_payment_method_id: paymentMethodId,
        card_last4: last4,
        card_brand: brand,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    return NextResponse.json({
      success: true,
      cardLast4: last4,
      cardBrand: brand,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Confirm billing error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
