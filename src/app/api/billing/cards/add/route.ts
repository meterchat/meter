import { NextRequest, NextResponse } from "next/server";
import { getStripe, ensureStripeCustomer } from "@/lib/stripe-billing";
import { requireAuth } from "@/lib/auth";

// POST /api/billing/cards/add — create Stripe SetupIntent for adding a new card
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const stripe = getStripe();
    const { customerId } = await ensureStripeCustomer(userId);

    const setupIntent = await stripe.setupIntents.create({
      customer: customerId,
      automatic_payment_methods: { enabled: true },
      metadata: { meter_user_id: userId },
    });

    return NextResponse.json({
      clientSecret: setupIntent.client_secret,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Add card error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
