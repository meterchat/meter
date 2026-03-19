import { NextResponse } from "next/server";
import { getWhop } from "@/lib/whop";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();
    const { data: user } = await supabase
      .from("meter_users")
      .select("whop_member_id, whop_payment_method_id")
      .eq("id", userId)
      .single();

    if (!user?.whop_member_id) {
      return NextResponse.json({ cards: [] });
    }

    const whop = getWhop();
    const methods = await whop.paymentMethods.list({
      member_id: user.whop_member_id,
    });

    const defaultPmId = user.whop_payment_method_id;

    // Card details are nested under pm.card for CardPaymentMethod variants
    const cards = (methods.data ?? []).map((pm) => {
      const card = "card" in pm ? (pm as { card: { brand?: string | null; last4?: string | null; exp_month?: number | null; exp_year?: number | null } }).card : null;
      return {
        id: pm.id,
        brand: card?.brand ?? "unknown",
        last4: card?.last4 ?? "0000",
        expMonth: card?.exp_month ?? 0,
        expYear: card?.exp_year ?? 0,
        isDefault: pm.id === defaultPmId,
      };
    });

    // Self-heal: if the webhook didn't save card details to the user record,
    // patch them now so cardOnFile is correct on next login.
    if (cards.length > 0) {
      const defaultCard = cards.find((c) => c.isDefault) ?? cards[0];
      const { data: currentUser } = await supabase
        .from("meter_users")
        .select("card_last4")
        .eq("id", userId)
        .single();
      if (!currentUser?.card_last4 && defaultCard.last4 !== "0000") {
        await supabase
          .from("meter_users")
          .update({
            card_last4: defaultCard.last4,
            card_brand: defaultCard.brand,
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
    }

    return NextResponse.json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("List cards error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
