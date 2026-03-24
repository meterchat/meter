import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe-billing";
import { getSupabaseServer } from "@/lib/supabase";
import type Stripe from "stripe";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature");

  if (!sig) {
    return NextResponse.json({ error: "Missing stripe-signature header" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    const stripe = getStripe();
    event = stripe.webhooks.constructEvent(
      body,
      sig,
      process.env.STRIPE_WEBHOOK_SECRET!,
    );
  } catch (err) {
    console.error("Stripe webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    switch (event.type) {
      case "payment_intent.succeeded": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const metadata = pi.metadata ?? {};
        const amount = pi.amount; // in cents

        await supabase.from("log_entries").insert({
          id: generateId(),
          type: "payment_succeeded",
          actor: resolveActor(metadata.meter_user_id),
          feedback_text: `$${(amount / 100).toFixed(2)} charge succeeded`,
        }).then(() => {}, (e: unknown) => console.error("Failed to log payment_intent.succeeded:", e));
        break;
      }

      case "payment_intent.payment_failed": {
        const pi = event.data.object as Stripe.PaymentIntent;
        const metadata = pi.metadata ?? {};
        const amount = pi.amount;
        const failureMsg = pi.last_payment_error?.message ?? "unknown reason";

        // Mark workspace as settlement failed
        if (metadata.workspace_id && metadata.meter_user_id) {
          const dbSessionId = metadata.meter_user_id.includes(":")
            ? metadata.workspace_id
            : `${metadata.meter_user_id}:${metadata.workspace_id}`;
          await supabase
            .from("chat_sessions")
            .update({ settlement_failed: true })
            .eq("id", dbSessionId)
            .eq("user_id", metadata.meter_user_id)
            .then(() => {}, () => {});
        }

        await supabase.from("log_entries").insert({
          id: generateId(),
          type: "payment_failed",
          actor: resolveActor(metadata.meter_user_id),
          feedback_text: `$${(amount / 100).toFixed(2)} charge failed: ${failureMsg.slice(0, 80)}`,
        }).then(() => {}, (e: unknown) => console.error("Failed to log payment_intent.payment_failed:", e));
        break;
      }

      case "setup_intent.succeeded": {
        const si = event.data.object as Stripe.SetupIntent;
        const metadata = si.metadata ?? {};
        const userId = metadata.meter_user_id;
        const customerId = typeof si.customer === "string" ? si.customer : si.customer?.id;
        const paymentMethodId = typeof si.payment_method === "string" ? si.payment_method : si.payment_method?.id;

        if (userId && customerId && paymentMethodId) {
          const stripe = getStripe();
          const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
          const card = pm.card;

          // Save card details
          await supabase
            .from("meter_users")
            .update({
              stripe_customer_id: customerId,
              stripe_payment_method_id: paymentMethodId,
              card_last4: card?.last4 ?? null,
              card_brand: card?.brand ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
        }

        await supabase.from("log_entries").insert({
          id: generateId(),
          type: "card_saved",
          actor: resolveActor(userId),
          feedback_text: "Card saved successfully",
        }).then(() => {}, (e: unknown) => console.error("Failed to log setup_intent.succeeded:", e));
        break;
      }

      default:
        // Event type we don't handle — acknowledge it
        break;
    }
  } catch (err) {
    console.error("Failed to process Stripe webhook:", err);
    // Still return 200 to prevent retries for processing errors
  }

  return NextResponse.json({ received: true });
}

function resolveActor(userId?: string): string {
  if (!userId) return "stripe";
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 6);
}
