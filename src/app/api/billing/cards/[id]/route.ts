import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe-billing";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { id: paymentMethodId } = await params;
    if (!paymentMethodId) {
      return NextResponse.json({ error: "card id required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    const { data: user } = await supabase
      .from("meter_users")
      .select("stripe_customer_id, stripe_payment_method_id")
      .eq("id", userId)
      .single();

    if (!user?.stripe_customer_id || !user.stripe_customer_id.startsWith("cus_")) {
      return NextResponse.json({ error: "No payment methods on file" }, { status: 400 });
    }

    const stripe = getStripe();
    const methods = await stripe.paymentMethods.list({
      customer: user.stripe_customer_id,
      type: "card",
    });

    const allCards = methods.data;

    if (allCards.length <= 1) {
      return NextResponse.json(
        { error: "Cannot remove your only card. Add another card first." },
        { status: 400 }
      );
    }

    const isDefault = user.stripe_payment_method_id === paymentMethodId;

    // Detach the payment method from the customer
    await stripe.paymentMethods.detach(paymentMethodId);

    if (isDefault) {
      const remaining = allCards.filter((m) => m.id !== paymentMethodId);
      if (remaining.length > 0) {
        const newDefault = remaining[0];
        await supabase
          .from("meter_users")
          .update({
            stripe_payment_method_id: newDefault.id,
            card_last4: newDefault.card?.last4 ?? "0000",
            card_brand: newDefault.card?.brand ?? "unknown",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Remove card error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
