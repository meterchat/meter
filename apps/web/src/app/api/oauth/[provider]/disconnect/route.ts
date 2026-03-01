import { NextRequest, NextResponse } from "next/server";
import { deleteToken } from "@/lib/oauth";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { serverTrackOAuthDisconnected } from "@/lib/analytics-server";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { provider: providerId } = await params;
  const { workspaceId } = await req.json();

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  await deleteToken(userId, providerId, workspaceId);
  serverTrackOAuthDisconnected(userId, { provider: providerId, workspaceId });

  // Backward compat: update gmail_connected field
  if (providerId === "gmail") {
    const supabase = getSupabaseServer();
    await supabase
      .from("meter_users")
      .update({ gmail_connected: false })
      .eq("id", userId);
  }

  return NextResponse.json({ ok: true });
}
