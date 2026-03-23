import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";

export const dynamic = "force-dynamic";

/** GET /api/admin/credits?userId=<id> — get a user's credit balance (superadmin only) */
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const userId = req.nextUrl.searchParams.get("userId");
  if (!userId) {
    return NextResponse.json({ error: "userId query parameter required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();
  const { data: user, error } = await supabase
    .from("meter_users")
    .select("id, email, handle, credit_balance")
    .eq("id", userId)
    .single();

  if (error || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    handle: user.handle,
    creditBalance: Number(user.credit_balance ?? 0),
  });
}

/** PUT /api/admin/credits — set a user's credit balance (superadmin only) */
export async function PUT(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const { userId, amount } = await req.json();

  if (!userId) {
    return NextResponse.json({ error: "userId required" }, { status: 400 });
  }
  if (amount == null || isNaN(Number(amount)) || Number(amount) < 0) {
    return NextResponse.json({ error: "amount must be a number >= 0" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Verify user exists
  const { data: user, error: findErr } = await supabase
    .from("meter_users")
    .select("id, email, handle, credit_balance")
    .eq("id", userId)
    .single();

  if (findErr || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const previousBalance = Number(user.credit_balance ?? 0);
  const newBalance = Number(amount);

  const { error: updateErr } = await supabase
    .from("meter_users")
    .update({ credit_balance: newBalance, updated_at: new Date().toISOString() })
    .eq("id", userId);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  console.log(`[admin-credits] Set credit_balance for ${userId}: ${previousBalance} → ${newBalance} (by ${auth.userId})`);

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    handle: user.handle,
    previousBalance,
    creditBalance: newBalance,
  });
}
