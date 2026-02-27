import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("settlement_history")
      .select("*")
      .eq("user_id", userId)
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: false })
      .limit(50);

    if (error) {
      console.error("Settlement history error:", error);
      return NextResponse.json({ history: [] });
    }

    const history = (data ?? []).map((r: Record<string, unknown>) => ({
      id: r.id,
      amount: Number(r.amount),
      workspaceId: r.workspace_id,
      stripePaymentIntentId: r.stripe_payment_intent_id,
      txHash: r.tx_hash,
      messageCount: r.message_count ?? 0,
      chargeCount: r.charge_count ?? 0,
      cardLast4: r.card_last4,
      cardBrand: r.card_brand,
      status: r.status ?? "succeeded",
      createdAt: r.created_at,
    }));

    return NextResponse.json({ history });
  } catch (err) {
    console.error("Settlement history error:", err);
    return NextResponse.json({ history: [] });
  }
}
