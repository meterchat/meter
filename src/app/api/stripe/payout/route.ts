import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function POST(req: NextRequest) {
  try {
    const { amount, currency } = await req.json();

    const cur = currency ?? "usd";

    // Check our platform Stripe balance
    const balance = await stripe.balance.retrieve();
    const available = balance.available.find((b) => b.currency === cur);

    if (!available || available.amount <= 0) {
      return NextResponse.json(
        {
          error: `No available balance to pay out (${cur.toUpperCase()})`,
          available: balance.available.map((b) => ({
            amount: b.amount / 100,
            currency: b.currency,
          })),
        },
        { status: 400 }
      );
    }

    // Use the requested amount (in dollars) or the full available balance
    const payoutAmountCents = amount
      ? Math.min(Math.round(amount * 100), available.amount)
      : available.amount;

    if (payoutAmountCents <= 0) {
      return NextResponse.json(
        { error: "Payout amount must be greater than zero" },
        { status: 400 }
      );
    }

    const payout = await stripe.payouts.create({
      amount: payoutAmountCents,
      currency: cur,
      description: "Meter platform payout",
    });

    return NextResponse.json({
      success: true,
      payout: {
        id: payout.id,
        amount: payout.amount / 100,
        currency: payout.currency,
        status: payout.status,
        arrival_date: payout.arrival_date,
        description: payout.description,
        method: payout.method,
      },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Payout error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
