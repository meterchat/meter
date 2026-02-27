import { NextRequest, NextResponse } from "next/server";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { requireAuth } from "@/lib/auth";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const customerId = await ensureStripeCustomer(userId);

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      payment_method_types: ["card"],
      metadata: { meter_user_id: userId },
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
      customerId,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Add card error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
