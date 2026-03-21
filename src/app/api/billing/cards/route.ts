import { NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe-billing";
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
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", userId)
      .single();

    if (!user?.stripe_customer_id) {
      return NextResponse.json({ cards: [] });
    }

    const stripe = getStripe();
    const methods = await stripe.paymentMethods.list({
      customer: user.stripe_customer_id,
      type: "card",
    });

    const defaultPmId = user.stripe_payment_method_id;

    const cards = methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "unknown",
      last4: pm.card?.last4 ?? "0000",
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
      isDefault: pm.id === defaultPmId,
    }));

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
