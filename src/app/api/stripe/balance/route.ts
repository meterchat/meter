import { NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";

export async function GET() {
  try {
    const [balance, payouts] = await Promise.all([
      stripe.balance.retrieve(),
      stripe.payouts.list({ limit: 10 }),
    ]);

    return NextResponse.json({
      balance: {
        available: balance.available.map((b) => ({
          amount: b.amount / 100,
          currency: b.currency,
        })),
        pending: balance.pending.map((b) => ({
          amount: b.amount / 100,
          currency: b.currency,
        })),
      },
      recentPayouts: payouts.data.map((p) => ({
        id: p.id,
        amount: p.amount / 100,
        currency: p.currency,
        status: p.status,
        arrival_date: p.arrival_date,
        created: p.created,
        description: p.description,
      })),
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Balance error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
