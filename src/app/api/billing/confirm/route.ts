import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe-billing";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/billing/confirm — called after Stripe setup completes
// Saves card details and creates a $10 pre-auth hold to validate the card.
// If the pre-auth fails, the card is detached and the user must try a different card.
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

    if (!customerId) {
      return NextResponse.json({ error: "Payment method has no customer" }, { status: 400 });
    }

    // Attempt $10 pre-auth hold to validate card has funds
    let preauthId: string | null = null;
    try {
      const holdIntent = await stripe.paymentIntents.create({
        amount: 1000, // $10 in cents
        currency: "usd",
        customer: customerId,
        payment_method: paymentMethodId,
        capture_method: "manual",
        off_session: true,
        confirm: true,
        metadata: { meter_user_id: userId, type: "preauth_hold" },
      });
      preauthId = holdIntent.id;
    } catch (holdErr) {
      // Pre-auth failed — card is invalid or insufficient funds
      // Detach the payment method so it can't be used
      console.error("Pre-auth hold failed, rejecting card:", holdErr);
      try {
        await stripe.paymentMethods.detach(paymentMethodId);
      } catch { /* best effort */ }

      return NextResponse.json({
        success: false,
        preauthFailed: true,
        error: `Card declined: ${holdErr instanceof Error ? holdErr.message : "unable to authorize"}`,
      });
    }

    // Pre-auth succeeded — save card details
    const supabase = getSupabaseServer();
    await supabase
      .from("meter_users")
      .update({
        stripe_customer_id: customerId,
        stripe_payment_method_id: paymentMethodId,
        card_last4: last4,
        card_brand: brand,
        preauth_payment_intent_id: preauthId,
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
