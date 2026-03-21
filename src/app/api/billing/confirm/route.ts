import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe-billing";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/billing/confirm — called after Stripe setup completes
// The setup_intent.succeeded webhook is the primary handler, but this endpoint
// can be used as a fallback for manual confirmation with known payment method details.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { paymentMethodId } = await req.json();

    if (!paymentMethodId) {
      return NextResponse.json({ error: "paymentMethodId required" }, { status: 400 });
    }

    const stripe = getStripe();
    const pm = await stripe.paymentMethods.retrieve(paymentMethodId);

    const customerId = typeof pm.customer === "string" ? pm.customer : pm.customer?.id;
    const last4 = pm.card?.last4 ?? "0000";
    const brand = pm.card?.brand ?? "unknown";

    const supabase = getSupabaseServer();

    await supabase
      .from("meter_users")
      .update({
        stripe_customer_id: customerId ?? null,
        stripe_payment_method_id: paymentMethodId,
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
