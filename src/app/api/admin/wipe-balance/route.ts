import { NextRequest, NextResponse } from "next/server";
import { requireSuperAdmin } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";

/** POST /api/admin/wipe-balance — mark all unsettled messages as settled for a user (superadmin only) */
export async function POST(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  const { email, handle, userId } = await req.json();

  if (!email && !handle && !userId) {
    return NextResponse.json({ error: "email, handle, or userId required" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Find the user
  let query = supabase.from("meter_users").select("id, email, handle");
  if (userId) query = query.eq("id", userId);
  else if (email) query = query.eq("email", email);
  else query = query.eq("handle", handle);

  const { data: user, error } = await query.single();
  if (error || !user) {
    return NextResponse.json({ error: "User not found" }, { status: 404 });
  }

  // Find all sessions for this user
  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("user_id", user.id);

  if (!sessions?.length) {
    return NextResponse.json({ userId: user.id, messagesSettled: 0 });
  }

  const sessionIds = sessions.map((s: { id: string }) => s.id);

  // Mark all unsettled messages as settled
  const { data: updated, error: updateErr } = await supabase
    .from("chat_messages")
    .update({ settled: true, receipt_status: "settled" })
    .in("session_id", sessionIds)
    .eq("settled", false)
    .select("id");

  if (updateErr) {
    return NextResponse.json({ error: updateErr.message }, { status: 500 });
  }

  return NextResponse.json({
    userId: user.id,
    email: user.email,
    handle: user.handle,
    messagesSettled: updated?.length ?? 0,
  });
}
