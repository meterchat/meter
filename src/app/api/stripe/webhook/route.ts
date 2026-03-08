import { NextRequest, NextResponse } from "next/server";
import Stripe from "stripe";
import { getSupabaseServer } from "@/lib/supabase";

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2026-01-28.clover",
  typescript: true,
});

const WEBHOOK_SECRET = process.env.STRIPE_WEBHOOK_SECRET;

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

// Map Stripe event types to our log event types
const EVENT_MAP: Record<string, { type: string; preview: (event: Stripe.Event) => string }> = {
  "payment_intent.succeeded": {
    type: "payment_succeeded",
    preview: (e) => {
      const pi = e.data.object as Stripe.PaymentIntent;
      return `$${(pi.amount / 100).toFixed(2)} charge succeeded`;
    },
  },
  "payment_intent.payment_failed": {
    type: "payment_failed",
    preview: (e) => {
      const pi = e.data.object as Stripe.PaymentIntent;
      const msg = pi.last_payment_error?.message ?? "unknown reason";
      return `$${(pi.amount / 100).toFixed(2)} charge failed: ${msg.slice(0, 80)}`;
    },
  },
  "setup_intent.succeeded": {
    type: "auth_hold_created",
    preview: () => "Card authorized and saved",
  },
  "charge.refunded": {
    type: "refund_issued",
    preview: (e) => {
      const ch = e.data.object as Stripe.Charge;
      const refunded = ch.amount_refunded ?? ch.amount;
      return `$${(refunded / 100).toFixed(2)} refunded`;
    },
  },
  "charge.dispute.created": {
    type: "refund_issued",
    preview: (e) => {
      const dispute = e.data.object as Stripe.Dispute;
      return `$${(dispute.amount / 100).toFixed(2)} chargeback opened`;
    },
  },
};

export async function POST(request: NextRequest) {
  if (!WEBHOOK_SECRET) {
    return NextResponse.json({ error: "Webhook secret not configured" }, { status: 500 });
  }

  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing signature" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, WEBHOOK_SECRET);
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const mapping = EVENT_MAP[event.type];
  if (!mapping) {
    // Event type we don't track — acknowledge it
    return NextResponse.json({ received: true });
  }

  try {
    const supabase = getSupabaseServer();
    const preview = mapping.preview(event);

    // Try to resolve actor from customer metadata
    let actor = "stripe";
    const obj = event.data.object as Record<string, unknown>;
    const customerId = (obj.customer as string) ?? null;
    if (customerId) {
      const { data: user } = await supabase
        .from("meter_users")
        .select("id")
        .eq("stripe_customer_id", customerId)
        .single();
      if (user?.id) {
        // Hash to match our anonymous actor format
        let h = 0;
        for (let i = 0; i < user.id.length; i++) {
          h = (Math.imul(31, h) + user.id.charCodeAt(i)) | 0;
        }
        actor = Math.abs(h).toString(16).slice(0, 6);
      }
    }

    await supabase.from("log_entries").insert({
      id: generateId(),
      type: mapping.type,
      actor,
      preview: preview.slice(0, 120),
    });
  } catch (err) {
    console.error("Failed to log Stripe event:", err);
    // Still return 200 so Stripe doesn't retry
  }

  return NextResponse.json({ received: true });
}
