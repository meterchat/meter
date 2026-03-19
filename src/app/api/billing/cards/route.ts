import { NextResponse } from "next/server";
import { getWhop } from "@/lib/whop";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();
    const { data: user } = await supabase
      .from("meter_users")
      .select("whop_member_id, whop_payment_method_id")
      .eq("id", userId)
      .single();

    if (!user?.whop_member_id) {
      return NextResponse.json({ cards: [] });
    }

    const whop = getWhop();
    const methods = await whop.paymentMethods.list({
      member_id: user.whop_member_id,
    });

    const defaultPmId = user.whop_payment_method_id;

    const cards = (methods.data ?? []).map((pm: Record<string, unknown>) => ({
      id: pm.id as string,
      brand: (pm.brand as string) ?? "unknown",
      last4: (pm.last4 as string) ?? "0000",
      expMonth: (pm.exp_month as number) ?? 0,
      expYear: (pm.exp_year as number) ?? 0,
      isDefault: pm.id === defaultPmId,
    }));

    return NextResponse.json({ cards });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("List cards error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
