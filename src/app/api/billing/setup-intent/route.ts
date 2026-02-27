import { NextRequest, NextResponse } from "next/server";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { requireAuth } from "@/lib/auth";

// POST /api/billing/setup-intent — create Stripe SetupIntent for saving a card
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const customerId = await ensureStripeCustomer(userId);

    // Create SetupIntent
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
    console.error("Setup intent error:", message);
    return NextResponse.json(
      { error: message.includes("relation") ? "Database tables not set up. Visit /api/setup-db first." : message },
      { status: 500 }
    );
  }
}
