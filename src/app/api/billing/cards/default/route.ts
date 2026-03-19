import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getWhop } from "@/lib/whop";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { paymentMethodId } = await req.json();
    if (!paymentMethodId) {
      return NextResponse.json({ error: "paymentMethodId required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Look up payment method details from Whop if needed for last4/brand
    // For now, update our tracking of which payment method is default
    const { data: user } = await supabase
      .from("meter_users")
      .select("whop_member_id")
      .eq("id", userId)
      .single();

    if (!user?.whop_member_id) {
      return NextResponse.json({ error: "No payment methods on file" }, { status: 400 });
    }

    // Get all payment methods to find the card details for the selected one
    const whop = getWhop();
    const methods = await whop.paymentMethods.list({
      member_id: user.whop_member_id,
    });

    const selected = (methods.data ?? []).find((pm) => pm.id === paymentMethodId);
    const card = selected && "card" in selected ? (selected as { card: { last4?: string | null; brand?: string | null } }).card : null;
    const last4 = card?.last4 ?? "0000";
    const brand = card?.brand ?? "unknown";

    await supabase
      .from("meter_users")
      .update({
        whop_payment_method_id: paymentMethodId,
        card_last4: last4,
        card_brand: brand,
        updated_at: new Date().toISOString(),
      })
      .eq("id", userId);

    return NextResponse.json({ success: true, cardLast4: last4, cardBrand: brand });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Set default card error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
