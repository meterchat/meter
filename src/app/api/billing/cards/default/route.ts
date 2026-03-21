import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { getStripe } from "@/lib/stripe-billing";
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

    const { data: user } = await supabase
      .from("meter_users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (!user?.stripe_customer_id || !user.stripe_customer_id.startsWith("cus_")) {
      return NextResponse.json({ error: "No payment methods on file" }, { status: 400 });
    }

    // Update the default payment method on the Stripe customer
    const stripe = getStripe();
    await stripe.customers.update(user.stripe_customer_id, {
      invoice_settings: { default_payment_method: paymentMethodId },
    });

    // Fetch card details for the selected payment method
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
    const last4 = pm.card?.last4 ?? "0000";
    const brand = pm.card?.brand ?? "unknown";

    await supabase
      .from("meter_users")
      .update({
        stripe_payment_method_id: paymentMethodId,
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
