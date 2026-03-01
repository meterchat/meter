import { NextRequest, NextResponse } from "next/server";
import { getStripe } from "@/lib/stripe";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { deleteAllUserSessions } from "@/lib/session";
import { serverTrackAccountDeleted } from "@/lib/analytics-server";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {

    const supabase = getSupabaseServer();

    const { data: user } = await supabase
      .from("meter_users")
      .select("id, stripe_customer_id")
      .eq("id", userId)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Check for unsettled balance
    const { data: sessions } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("user_id", userId);

    if (sessions && sessions.length > 0) {
      const sessionIds = sessions.map((s: { id: string }) => s.id);
      const { data: unsettled } = await supabase
        .from("chat_messages")
        .select("cost")
        .in("session_id", sessionIds)
        .eq("role", "assistant")
        .eq("settled", false)
        .not("cost", "is", null);

      const outstanding = (unsettled ?? []).reduce((sum: number, m: { cost: number }) => sum + (m.cost ?? 0), 0);
      if (outstanding > 0.01) {
        return NextResponse.json(
          { error: `Please settle your outstanding balance ($${outstanding.toFixed(2)}) before deleting your account.` },
          { status: 400 }
        );
      }
    }

    // Delete Stripe customer
    if (user.stripe_customer_id) {
      try {
        await getStripe().customers.del(user.stripe_customer_id);
      } catch (e) {
        console.error("Stripe customer deletion failed:", e);
      }
    }

    // Delete related data without cascade
    const { data: userSessions } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("user_id", userId);

    if (userSessions && userSessions.length > 0) {
      const sIds = userSessions.map((s: { id: string }) => s.id);
      await supabase.from("chat_messages").delete().in("session_id", sIds);
      await supabase.from("chat_sessions").delete().eq("user_id", userId);
    }

    await supabase.from("decisions").delete().eq("user_id", userId);
    await supabase.from("workspace_projects").delete().in(
      "workspace_id",
      (await supabase.from("workspaces").select("id").eq("user_id", userId)).data?.map((w: { id: string }) => w.id) ?? []
    );
    await supabase.from("workspaces").delete().eq("user_id", userId);
    await supabase.from("settlement_history").delete().eq("user_id", userId);

    // Delete all auth sessions
    await deleteAllUserSessions(userId);

    // Delete user (cascades passkey_credentials, oauth_tokens)
    await supabase.from("meter_users").delete().eq("id", userId);

    serverTrackAccountDeleted(userId);

    return NextResponse.json({ success: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Account deletion error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
