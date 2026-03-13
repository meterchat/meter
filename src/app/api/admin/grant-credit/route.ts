import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";

/** POST /api/admin/grant-credit — grant free USD credit to a user (superadmin only) */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const { email, handle, amount } = await req.json();

  if (!email && !handle) {
    return NextResponse.json({ error: "email or handle required" }, { status: 400 });
  }
  const amt = Number(amount);
  if (isNaN(amt) || amt <= 0) {
    return NextResponse.json({ error: "amount must be a positive number" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Find the user
  let query = supabase.from("meter_users").select("id, email, handle, free_credit_remaining");
  if (email) query = query.eq("email", email);
  else query = query.eq("handle", handle);

  const { data: user, error } = await query.single();
  if (error || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  const newBalance = Number(user.free_credit_remaining ?? 0) + amt;
  const { error: updateErr } = await supabase
    .from("meter_users")
    .update({ free_credit_remaining: newBalance })
    .eq("id", user.id);

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    handle: user.handle,
    previousBalance: Number(user.free_credit_remaining ?? 0),
    granted: amt,
    newBalance,
  });
}
