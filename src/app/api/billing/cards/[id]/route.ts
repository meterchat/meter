import { NextRequest, NextResponse } from "next/server";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
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

    const customerId = await ensureStripeCustomer(userId);
    const supabase = getSupabaseServer();

    const methods = await stripe.customers.listPaymentMethods(
      customerId,
      { type: "card", limit: 10 }
    );

    if (methods.data.length <= 1) {
      return NextResponse.json(
        { error: "Cannot remove your only card. Add another card first." },
        { status: 400 }
      );
    }

    const customer = await stripe.customers.retrieve(customerId);
    const isDefault =
      !customer.deleted &&
      (customer.invoice_settings?.default_payment_method === paymentMethodId ||
        (typeof customer.invoice_settings?.default_payment_method === "object" &&
          customer.invoice_settings?.default_payment_method?.id === paymentMethodId));

    await stripe.paymentMethods.detach(paymentMethodId);

    if (isDefault) {
      const remaining = methods.data.filter((m) => m.id !== paymentMethodId);
      if (remaining.length > 0) {
        const newDefault = remaining[0];
        await stripe.customers.update(customerId, {
          invoice_settings: { default_payment_method: newDefault.id },
        });
        await supabase
          .from("meter_users")
          .update({
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
