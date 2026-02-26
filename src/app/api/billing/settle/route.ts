import { NextRequest, NextResponse } from "next/server";
import { stripe, ensureStripeCustomer } from "@/lib/stripe";
import { getSupabaseServer } from "@/lib/supabase";
import { batchSettle, SettlementItem } from "@/lib/base";
import { requireAuth, isSuperAdmin } from "@/lib/auth";
import {
  serverTrackSettlementCompleted,
  serverTrackSettlementFailed,
  serverTrackSettlementWaived,
} from "@/lib/analytics-server";

function scopedSessionId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

/** Verify all messageIds belong to sessions owned by userId */
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

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { stripeCustomerId, workspaceId, amount, messageIds, chargeIds } = await req.json();

  if (!workspaceId || !amount || amount <= 0) {
    return NextResponse.json({ error: "workspaceId and positive amount required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const dbSessionId = scopedSessionId(userId, workspaceId);

  // Superadmin accounts don't charge — just mark messages settled and record it
  if (await isSuperAdmin(userId)) {
    if (messageIds && messageIds.length > 0) {
      if (!(await verifyMessageOwnership(supabase, userId, messageIds))) {
        return NextResponse.json({ error: "Forbidden: message ownership mismatch" }, { status: 403 });
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
      tx_hash: null,
      message_count: messageIds?.length ?? 0,
      charge_count: chargeIds?.length ?? 0,
      card_last4: null,
      card_brand: null,
      status: "waived",
    }).then(() => {}, (e: unknown) => console.error("Failed to write settlement history:", e));

    serverTrackSettlementWaived(userId, {
      amount,
      workspaceId,
      messageCount: messageIds?.length ?? 0,
    });

    return NextResponse.json({
      success: true,
      paymentIntentId: null,
      txHash: null,
      amountCharged: 0,
      waived: true,
    });
  }

  async function markSettlementFailed() {
    await supabase
      .from("chat_sessions")
      .update({ settlement_failed: true })
      .eq("id", dbSessionId)
      .eq("user_id", userId);
  }

  try {
    // Resolve Stripe customer (auto-creates if stale/missing)
    const customerId = await ensureStripeCustomer(userId);

    // Get customer's default payment method
    const customer = await stripe.customers.retrieve(customerId);
    if (customer.deleted) {
      return NextResponse.json({ error: "Stripe customer deleted" }, { status: 400 });
    }
    const defaultPm = customer.invoice_settings?.default_payment_method;
    if (!defaultPm) {
      return NextResponse.json({ error: "No payment method on file" }, { status: 400 });
    }

    // Create and confirm PaymentIntent
    const amountCents = Math.round(amount * 100);
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amountCents,
      currency: "usd",
      customer: customerId,
      payment_method: typeof defaultPm === "string" ? defaultPm : defaultPm.id,
      confirm: true,
      off_session: true,
      description: `Meter settlement — ${(messageIds?.length ?? 0)} messages, ${(chargeIds?.length ?? 0)} card charges`,
      metadata: {
        meter_user_id: userId,
        workspace_id: workspaceId,
        message_count: String(messageIds?.length ?? 0),
        charge_count: String(chargeIds?.length ?? 0),
      },
    });

    if (paymentIntent.status !== "succeeded") {
      await markSettlementFailed();
      return NextResponse.json(
        { error: "Payment not succeeded", status: paymentIntent.status },
        { status: 402 }
      );
    }

    // Update messages in Supabase
    if (messageIds && messageIds.length > 0) {
      if (!(await verifyMessageOwnership(supabase, userId, messageIds))) {
        return NextResponse.json({ error: "Forbidden: message ownership mismatch" }, { status: 403 });
      }
      await supabase
        .from("chat_messages")
        .update({ settled: true, receipt_status: "settled" })
        .in("id", messageIds);
    }

    // Batch settle on Base
    const items: SettlementItem[] = [
      ...(messageIds ?? []).map((id: string) => ({ id, amount: 0, type: "usage" as const })),
      ...(chargeIds ?? []).map((id: string) => ({ id, amount: 0, type: "card" as const })),
    ];

    let txHash: string | undefined;
    try {
      txHash = await batchSettle(userId, items, amount);

      // Persist tx hash to settled messages
      if (txHash && messageIds && messageIds.length > 0) {
        await supabase
          .from("chat_messages")
          .update({ tx_hash: txHash })
          .in("id", messageIds);
      }
    } catch (err) {
      console.error("Base settlement failed (charge succeeded):", err);
    }

    // Get card info for history record
    const pmObj = typeof defaultPm === "string"
      ? await stripe.paymentMethods.retrieve(defaultPm)
      : defaultPm;
    const historyId = `stl_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    await supabase.from("settlement_history").insert({
      id: historyId,
      user_id: userId,
      workspace_id: workspaceId,
      amount,
      stripe_payment_intent_id: paymentIntent.id,
      tx_hash: txHash ?? null,
      message_count: messageIds?.length ?? 0,
      charge_count: chargeIds?.length ?? 0,
      card_last4: pmObj && "card" in pmObj ? pmObj.card?.last4 ?? null : null,
      card_brand: pmObj && "card" in pmObj ? pmObj.card?.brand ?? null : null,
      status: "succeeded",
    }).then(() => {}, (e: unknown) => console.error("Failed to write settlement history:", e));

    // Clear settlement_failed flag on success
    await supabase
      .from("chat_sessions")
      .update({ settlement_failed: false })
      .eq("id", dbSessionId)
      .eq("user_id", userId);

    serverTrackSettlementCompleted(userId, {
      amount,
      workspaceId,
      messageCount: messageIds?.length ?? 0,
      chargeCount: chargeIds?.length ?? 0,
      stripePaymentIntentId: paymentIntent.id,
      txHash: txHash ?? undefined,
      cardLast4: pmObj && "card" in pmObj ? pmObj.card?.last4 ?? undefined : undefined,
      cardBrand: pmObj && "card" in pmObj ? pmObj.card?.brand ?? undefined : undefined,
    });

    return NextResponse.json({
      success: true,
      paymentIntentId: paymentIntent.id,
      txHash: txHash ?? null,
      amountCharged: amount,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Settlement error:", message);

    serverTrackSettlementFailed(userId, {
      amount,
      workspaceId,
      error: message,
    });

    if (message.includes("authentication_required") || message.includes("card_declined")) {
      await markSettlementFailed().catch(() => {});
      return NextResponse.json({ error: "Payment failed: " + message }, { status: 402 });
    }

    return NextResponse.json({ error: message }, { status: 500 });
  }
}
