import { getStripe, ensureStripeCustomer } from "@/lib/stripe";
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
  paymentIntentId?: string | null;
  amountCharged?: number;
  creditUsed?: number;
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
    // ── Free credit deduction ──
    const { data: userRow } = await supabase
      .from("meter_users")
      .select("free_credit_remaining")
      .eq("id", userId)
      .single();
    const freeCredit = Number(userRow?.free_credit_remaining ?? 0);
    let creditUsed = 0;
    let chargeAmount = amount;

    if (freeCredit > 0) {
      creditUsed = Math.min(freeCredit, amount);
      chargeAmount = Math.round((amount - creditUsed) * 100) / 100;
      await supabase
        .from("meter_users")
        .update({ free_credit_remaining: Math.max(0, freeCredit - creditUsed) })
        .eq("id", userId);
    }

    // If free credit covers the full amount, skip card charge
    if (chargeAmount <= 0) {
      if (messageIds.length > 0) {
        if (!skipOwnershipCheck && !(await verifyMessageOwnership(supabase, userId, messageIds))) {
          return { success: false, error: "Forbidden: message ownership mismatch" };
        }
        await supabase
          .from("chat_messages")
          .update({ settled: true, receipt_status: "settled" })
          .in("id", messageIds);
      }
      const historyId = `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
      await supabase.from("settlement_history").insert({
        id: historyId,
        user_id: userId,
        workspace_id: workspaceId,
        amount,
        stripe_payment_intent_id: null,
        message_count: messageIds.length,
        charge_count: chargeIds.length,
        card_last4: null,
        card_brand: null,
        status: "bonus_credit",
        markup_multiplier: markupMultiplier,
      }).then(() => {}, (e: unknown) => console.error("Failed to write settlement history:", e));

      return { success: true, paymentIntentId: null, amountCharged: 0, creditUsed };
    }

    // Resolve Stripe customer
    const customerId = await ensureStripeCustomer(userId);

    const customer = await getStripe().customers.retrieve(customerId);
    if (customer.deleted) {
      return { success: false, error: "Stripe customer deleted" };
    }
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (!defaultPm) {
      return { success: false, error: "No payment method on file" };
    }

    // Create and confirm PaymentIntent
    const amountCents = Math.round(chargeAmount * 100);
    const paymentIntent = await getStripe().paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      payment_method: typeof defaultPm === "string" ? defaultPm : defaultPm.id,
      confirm: true,
      off_session: true,
      description: `Meter settlement — ${messageIds.length} messages, ${chargeIds.length} card charges`,
      metadata: {
        meter_user_id: userId,
        workspace_id: workspaceId,
        message_count: String(messageIds.length),
        charge_count: String(chargeIds.length),
      },
    });

    if (paymentIntent.status !== "succeeded") {
      await markSettlementFailed();
      return { success: false, error: `Payment not succeeded: ${paymentIntent.status}` };
    }

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

    // Record settlement history
    const pmObj = typeof defaultPm === "string"
      ? await getStripe().paymentMethods.retrieve(defaultPm)
      : defaultPm;
    const historyId = `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await supabase.from("settlement_history").insert({
      id: historyId,
      user_id: userId,
      workspace_id: workspaceId,
      amount,
      stripe_payment_intent_id: paymentIntent.id,
      message_count: messageIds.length,
      charge_count: chargeIds.length,
      card_last4: pmObj && "card" in pmObj ? pmObj.card?.last4 ?? null : null,
      card_brand: pmObj && "card" in pmObj ? pmObj.card?.brand ?? null : null,
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
      cardLast4: pmObj && "card" in pmObj ? pmObj.card?.last4 ?? undefined : undefined,
      cardBrand: pmObj && "card" in pmObj ? pmObj.card?.brand ?? undefined : undefined,
    });

    return { success: true, paymentIntentId: paymentIntent.id, amountCharged: amount };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Settlement error:", message);

    serverTrackSettlementFailed(userId, { amount, workspaceId, error: message });

    if (message.includes("authentication_required") || message.includes("card_declined")) {
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
