import { getStripe, ensureStripeCustomer } from "@/lib/stripe-billing";
import { getSupabaseServer } from "@/lib/supabase";
import {
  serverTrackSettlementCompleted,
  serverTrackSettlementFailed,
} from "@/lib/analytics-server";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";

export function scopedSessionId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

export interface SettleResult {
  success: boolean;
  error?: string;
  paymentId?: string | null;
  amountCharged?: number;
}

/**
 * Core settlement logic for a single workspace.
 * Handles free credit deduction, Stripe charge, message marking,
 * settlement history, and failure flagging.
 *
 * Used by both the user-facing /api/billing/settle route and the
 * server-side cron auto-settlement job.
 */
export async function settleWorkspace(opts: {
  userId: string;
  workspaceId: string;
  amount: number;
  messageIds: string[];
  chargeIds?: string[];
  /** Skip message ownership verification (used by cron where we already queried the messages) */
  skipOwnershipCheck?: boolean;
}): Promise<SettleResult> {
  const { userId, workspaceId, amount, messageIds, chargeIds = [], skipOwnershipCheck = false } = opts;
  const supabase = getSupabaseServer();
  const dbSessionId = scopedSessionId(userId, workspaceId);

  async function markSettlementFailed() {
    await supabase
      .from("chat_sessions")
      .update({ settlement_failed: true })
      .eq("id", dbSessionId)
      .eq("user_id", userId);
  }

  // Fetch current markup multiplier to store on the settlement row
  const { data: configRow } = await supabase
    .from("app_config")
    .select("markup_multiplier")
    .eq("id", "global")
    .single();
  const markupMultiplier = Number(configRow?.markup_multiplier) || DEFAULT_MARKUP_MULTIPLIER;

  try {
    // Resolve Stripe customer + payment method
    const { customerId, paymentMethodId } = await ensureStripeCustomer(userId);

    if (!paymentMethodId) {
      throw new Error("No payment method on file");
    }

    // Create off-session payment via Stripe
    const stripe = getStripe();
    const paymentIntent = await stripe.paymentIntents.create({
      amount: Math.round(amount * 100), // Stripe uses cents
      currency: "usd",
      customer: customerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        meter_user_id: userId,
        workspace_id: workspaceId,
        message_count: String(messageIds.length),
        charge_count: String(chargeIds.length),
      },
    });

    // Mark messages as settled
    if (messageIds.length > 0) {
      if (!skipOwnershipCheck && !(await verifyMessageOwnership(supabase, userId, messageIds))) {
        return { success: false, error: "Forbidden: message ownership mismatch" };
      }
      await supabase
        .from("chat_messages")
        .update({ settled: true, receipt_status: "settled" })
        .in("id", messageIds);
    }

    // Fetch card details from our DB for the settlement record
    const { data: cardUser } = await supabase
      .from("meter_users")
      .select("card_last4, card_brand")
      .eq("id", userId)
      .single();

    // Record settlement history
    const historyId = `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await supabase.from("settlement_history").insert({
      id: historyId,
      user_id: userId,
      workspace_id: workspaceId,
      amount,
      stripe_payment_intent_id: paymentIntent.id,
      message_count: messageIds.length,
      charge_count: chargeIds.length,
      card_last4: cardUser?.card_last4 ?? null,
      card_brand: cardUser?.card_brand ?? null,
      status: "succeeded",
      markup_multiplier: markupMultiplier,
    }).then(() => {}, (e: unknown) => console.error("Failed to write settlement history:", e));

    // Clear settlement_failed flag
    await supabase
      .from("chat_sessions")
      .update({ settlement_failed: false })
      .eq("id", dbSessionId)
      .eq("user_id", userId);

    serverTrackSettlementCompleted(userId, {
      amount,
      workspaceId,
      messageCount: messageIds.length,
      chargeCount: chargeIds.length,
      stripePaymentIntentId: paymentIntent.id,
      cardLast4: cardUser?.card_last4 ?? undefined,
      cardBrand: cardUser?.card_brand ?? undefined,
    });

    return { success: true, paymentId: paymentIntent.id, amountCharged: amount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Settlement error:", message);

    serverTrackSettlementFailed(userId, { amount, workspaceId, error: message });

    if (message.includes("authentication_required") || message.includes("card_declined") || message.includes("No payment method")) {
      await markSettlementFailed().catch(() => {});
    }

    return { success: false, error: message };
  }
}

async function verifyMessageOwnership(
  supabase: ReturnType<typeof getSupabaseServer>,
  userId: string,
  messageIds: string[],
): Promise<boolean> {
  if (!messageIds || messageIds.length === 0) return true;
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("user_id", userId);
  if (!sessions?.length) return false;
  const sessionIds = sessions.map((s: { id: string }) => s.id);
  const { data: msgs } = await supabase
    .from("chat_messages")
    .select("id")
    .in("id", messageIds)
    .in("session_id", sessionIds);
  return msgs !== null && msgs.length === messageIds.length;
}
