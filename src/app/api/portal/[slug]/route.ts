import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

/**
 * GET /api/portal/[slug]
 * Public endpoint — serves portal data (workspace name + artifacts) by slug.
 * No auth required — this is the hosted docs portal.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ slug: string }> },
) {
  const { slug } = await params;

  try {
    const supabase = getSupabaseServer();

    // Find the workspace by portal slug
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id, workspace_name, project_name, user_id, created_at")
      .eq("portal_slug", slug)
      .is("deleted_at", null)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Portal not found" }, { status: 404 });
    }

    // Fetch all artifacts for this workspace
    const { data: artifacts } = await supabase
      .from("artifacts")
      .select("id, file_path, content, status, category, last_generated_at, created_at, updated_at")
      .eq("user_id", session.user_id)
      .or(`session_id.eq.${session.id},project_id.eq.${session.id}`)
      .order("created_at", { ascending: true });

    return NextResponse.json({
      workspace: {
        name: session.workspace_name || session.project_name || "Workspace",
        slug,
        createdAt: session.created_at,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      documents: (artifacts ?? []).map((a: any) => ({
        id: a.id,
        filePath: a.file_path,
        content: a.content,
        category: a.category,
        lastGeneratedAt: a.last_generated_at,
        updatedAt: a.updated_at,
      })),
    });
  } catch (err) {
    console.error("Failed to load portal:", err);
    return NextResponse.json({ error: "Failed to load portal" }, { status: 500 });
  }
}
