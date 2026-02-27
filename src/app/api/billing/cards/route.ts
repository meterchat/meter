import { NextResponse } from "next/server";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const customerId = await ensureStripeCustomer(userId);

    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return NextResponse.json({ cards: [] });
    }

    const defaultPmId =
      typeof customer.invoice_settings?.default_payment_method === "string"
        ? customer.invoice_settings.default_payment_method
        : customer.invoice_settings?.default_payment_method?.id ?? null;

    const methods = await stripe.customers.listPaymentMethods(
      customerId,
      { type: "card", limit: 10 }
    );

    const cards = methods.data.map((pm) => ({
      id: pm.id,
      brand: pm.card?.brand ?? "unknown",
      last4: pm.card?.last4 ?? "0000",
      expMonth: pm.card?.exp_month ?? 0,
      expYear: pm.card?.exp_year ?? 0,
      isDefault: pm.id === defaultPmId,
    }));

    return NextResponse.json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("List cards error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
