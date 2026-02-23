import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import {
  OAUTH_PROVIDERS,
  generateState,
  buildAuthorizeUrl,
} from "@/lib/oauth";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { provider: providerId } = await params;
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");

    if (!workspaceId) {
      return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
    }

    const provider = OAUTH_PROVIDERS[providerId];
    if (!provider || provider.type !== "oauth") {
      return NextResponse.json({ error: "Invalid OAuth provider" }, { status: 400 });
    }

    const state = generateState();
    const appUrl = process.env.NEXT_PUBLIC_APP_URL || "https://meter.chat";
    const redirectUri = `${appUrl}/api/oauth/${providerId}/callback`;

    // Store state for CSRF validation (includes workspace context)
    const supabase = getSupabaseServer();
    const { error: stateError } = await supabase.from("oauth_state").insert({
      id: state,
      user_id: userId,
      provider: providerId,
      workspace_id: workspaceId,
      expires_at: new Date(Date.now() + 10 * 60 * 1000).toISOString(), // 10 min
    });
    if (stateError) {
      console.error("Failed to store OAuth state:", stateError.message);
      return NextResponse.json({ error: "Failed to initiate OAuth" }, { status: 500 });
    }

    const authorizeUrl = buildAuthorizeUrl(provider, state, redirectUri);
    return NextResponse.redirect(authorizeUrl);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("OAuth authorize error:", message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
