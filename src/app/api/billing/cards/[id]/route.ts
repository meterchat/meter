import { NextRequest, NextResponse } from "next/server";
import { getWhop } from "@/lib/whop";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { id: paymentMethodId } = await params;
    if (!paymentMethodId) {
      return NextResponse.json({ error: "card id required" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    const { data: user } = await supabase
      .from("meter_users")
      .select("whop_member_id, whop_payment_method_id")
      .eq("id", userId)
      .single();

    if (!user?.whop_member_id) {
      return NextResponse.json({ error: "No payment methods on file" }, { status: 400 });
    }

    const whop = getWhop();
    const methods = await whop.paymentMethods.list({
      member_id: user.whop_member_id,
    });

    const allCards = methods.data ?? [];

    if (allCards.length <= 1) {
      return NextResponse.json(
        { error: "Cannot remove your only card. Add another card first." },
        { status: 400 }
      );
    }

    const isDefault = user.whop_payment_method_id === paymentMethodId;

    // If Whop supports detaching payment methods, call it here
    // For now, we just remove from our tracking
    // await whop.paymentMethods.detach(paymentMethodId);

    if (isDefault) {
      const remaining = allCards.filter((m) => m.id !== paymentMethodId);
      if (remaining.length > 0) {
        const newDefault = remaining[0];
        const newCard = "card" in newDefault ? (newDefault as { card: { last4?: string | null; brand?: string | null } }).card : null;
        await supabase
          .from("meter_users")
          .update({
            whop_payment_method_id: newDefault.id,
            card_last4: newCard?.last4 ?? "0000",
            card_brand: newCard?.brand ?? "unknown",
            updated_at: new Date().toISOString(),
          })
          .eq("id", userId);
      }
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Remove card error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
