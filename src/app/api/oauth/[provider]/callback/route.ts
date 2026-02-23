import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  OAUTH_PROVIDERS,
  exchangeCodeForToken,
  storeToken,
} from "@/lib/oauth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  try {
    const { provider: providerId } = await params;
    const code = req.nextUrl.searchParams.get("code");
    const state = req.nextUrl.searchParams.get("state");
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meter.chat";

    if (!code || !state) {
      console.error(`OAuth callback for ${providerId}: missing code or state`);
      return NextResponse.redirect(`${appUrl}/?oauth=error&provider=${providerId}`);
    }

    const provider = OAUTH_PROVIDERS[providerId];
    if (!provider || provider.type !== "oauth") {
      console.error(`OAuth callback: invalid provider "${providerId}"`);
      return NextResponse.redirect(`${appUrl}/?oauth=error&provider=${providerId}`);
    }

    // Validate state (CSRF protection)
    const supabase = getSupabaseServer();
    const { data: stateRecord, error: stateError } = await supabase
      .from("oauth_state")
      .select("*")
      .eq("id", state)
      .eq("provider", providerId)
      .single();

    if (!stateRecord) {
      console.error(`OAuth callback for ${providerId}: state not found`, stateError?.message);
      return NextResponse.redirect(`${appUrl}/?oauth=error&provider=${providerId}`);
    }

    // Check expiry
    if (new Date(stateRecord.expires_at) < new Date()) {
      console.error(`OAuth callback for ${providerId}: state expired`);
      await supabase.from("oauth_state").delete().eq("id", state);
      return NextResponse.redirect(`${appUrl}/?oauth=error&provider=${providerId}`);
    }

    const userId = stateRecord.user_id;
    const workspaceId = stateRecord.workspace_id;

    // Clean up state record
    await supabase.from("oauth_state").delete().eq("id", state);

    try {
      const redirectUri = `${appUrl}/api/oauth/${providerId}/callback`;
      const tokenData = await exchangeCodeForToken(provider, code, redirectUri);
      await storeToken(userId, providerId, workspaceId, tokenData);

      // Backward compat: update gmail_connected field
      if (providerId === "gmail") {
        await supabase
          .from("meter_users")
          .update({ gmail_connected: true })
          .eq("id", userId);
      }

      return NextResponse.redirect(`${appUrl}/?oauth=success&provider=${providerId}`);
    } catch (err) {
      console.error(`OAuth callback error for ${providerId}:`, err);
      return NextResponse.redirect(`${appUrl}/?oauth=error&provider=${providerId}`);
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("OAuth callback error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
