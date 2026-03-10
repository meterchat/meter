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

    // Fetch user handle and workspace data in parallel
    const [{ data: user }, { data: session }] = await Promise.all([
      supabase.from("meter_users").select("handle").eq("id", userId).single(),
      supabase
        .from("chat_sessions")
        .select("portal_slug, workspace_name, project_name")
        .eq("id", sessionId)
        .eq("user_id", userId)
        .single(),
    ]);

    if (!session) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    const handle = user?.handle ?? null;

    if (session.portal_slug) {
      return NextResponse.json({ slug: session.portal_slug, handle });
    }

    // Generate a slug from the workspace name (unique per user, no suffix needed)
    const name = session.workspace_name || session.project_name || "workspace";
    const slug = generatePortalSlug(name);

    // Save it
    await supabase
      .from("chat_sessions")
      .update({ portal_slug: slug })
      .eq("id", sessionId)
      .eq("user_id", userId);

    return NextResponse.json({ slug, handle });
  } catch (err) {
    console.error("Failed to get/create portal slug:", err);
    return NextResponse.json({ error: "Failed to create portal" }, { status: 500 });
  }
}
