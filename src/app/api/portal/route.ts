import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { generatePortalSlug } from "@/lib/portal-slug";

/**
 * GET /api/portal?sessionId=xxx
 * Returns the portal slug for a workspace. Creates one if it doesn't exist.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "sessionId required" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServer();

    // Check if workspace already has a portal slug
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("portal_slug, workspace_name, project_name")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    if (session.portal_slug) {
      return NextResponse.json({ slug: session.portal_slug });
    }

    // Generate a new slug
    const name = session.workspace_name || session.project_name || "workspace";
    const slug = await generatePortalSlug(name, async (candidate) => {
      const { data } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("portal_slug", candidate)
        .maybeSingle();
      return !!data;
    });

    // Save it
    await supabase
      .from("chat_sessions")
      .update({ portal_slug: slug })
      .eq("id", sessionId)
      .eq("user_id", userId);

    return NextResponse.json({ slug });
  } catch (err) {
    console.error("Failed to get/create portal slug:", err);
    return NextResponse.json({ error: "Failed to create portal" }, { status: 500 });
  }
}
