import { NextRequest, NextResponse } from "next/server";
import { getWhop } from "@/lib/whop";
import { getSupabaseServer } from "@/lib/supabase";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

export async function POST(request: NextRequest) {
  const body = await request.text();
  const headers = Object.fromEntries(request.headers);

  let event: { type: string; data: Record<string, unknown> };
  try {
    const whop = getWhop();
    event = whop.webhooks.unwrap(body, { headers }) as typeof event;
  } catch (err) {
    console.error("Whop webhook signature verification failed:", err);
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  try {
    switch (event.type) {
      case "payment.succeeded": {
        const payment = event.data;
        const metadata = (payment.metadata ?? {}) as Record<string, string>;
        const amount = Number(payment.amount ?? payment.initial_price ?? 0);

        // Log to activity feed
        await supabase.from("log_entries").insert({
          id: generateId(),
          type: "payment_succeeded",
          actor: resolveActor(metadata.meter_user_id),
          preview: `$${(amount / 100).toFixed(2)} charge succeeded`,
        }).catch((e) => console.error("Failed to log payment.succeeded:", e));
        break;
      }

      case "payment.failed": {
        const payment = event.data;
        const metadata = (payment.metadata ?? {}) as Record<string, string>;
        const amount = Number(payment.amount ?? payment.initial_price ?? 0);
        const failureMsg = (payment.failure_message as string) ?? "unknown reason";

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
            .catch(() => {});
        }

        await supabase.from("log_entries").insert({
          id: generateId(),
          type: "payment_failed",
          actor: resolveActor(metadata.meter_user_id),
          preview: `$${(amount / 100).toFixed(2)} charge failed: ${failureMsg.slice(0, 80)}`,
        }).catch((e) => console.error("Failed to log payment.failed:", e));
        break;
      }

      case "setup_intent.succeeded": {
        const setupIntent = event.data;
        const metadata = (setupIntent.metadata ?? {}) as Record<string, string>;
        const userId = metadata.meter_user_id;
        const memberId = (setupIntent.member as { id: string })?.id ?? (setupIntent.member_id as string);
        const paymentMethod = setupIntent.payment_method as { id: string; card?: { last4?: string; brand?: string } | null; last4?: string; brand?: string } | undefined;

        if (userId && memberId && paymentMethod?.id) {
          // Card details are nested under payment_method.card in the Whop API
          const cardData = paymentMethod.card;
          await supabase
            .from("meter_users")
            .update({
              whop_member_id: memberId,
              whop_payment_method_id: paymentMethod.id,
              card_last4: cardData?.last4 ?? paymentMethod.last4 ?? null,
              card_brand: cardData?.brand ?? paymentMethod.brand ?? null,
              updated_at: new Date().toISOString(),
            })
            .eq("id", userId);
        }

        await supabase.from("log_entries").insert({
          id: generateId(),
          type: "auth_hold_created",
          actor: resolveActor(userId),
          preview: "Card authorized and saved",
        }).catch((e) => console.error("Failed to log setup_intent.succeeded:", e));
        break;
      }

      default:
        // Event type we don't handle — acknowledge it
        break;
    }
  } catch (err) {
    console.error("Failed to process Whop webhook:", err);
    // Still return 200 so Whop doesn't retry
  }

  return NextResponse.json({ received: true });
}

function resolveActor(userId?: string): string {
  if (!userId) return "whop";
  let h = 0;
  for (let i = 0; i < userId.length; i++) {
    h = (Math.imul(31, h) + userId.charCodeAt(i)) | 0;
  }
  return Math.abs(h).toString(16).slice(0, 6);
}
