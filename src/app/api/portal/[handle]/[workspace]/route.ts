import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

/**
 * GET /api/portal/[handle]/[workspace]
 * Public endpoint — serves portal data by user handle + workspace slug.
 * No auth required — this is the hosted docs portal.
 *
 * URL pattern: docs.meter.chat/{handle}/{workspace}
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ handle: string; workspace: string }> },
) {
  const { handle, workspace } = await params;

  try {
    const supabase = getSupabaseServer();

    // Find the user by handle
    const { data: user } = await supabase
      .from("meter_users")
      .select("id")
      .eq("handle", handle)
      .single();

    if (!user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Find the workspace by portal slug belonging to this user
    const { data: session } = await supabase
      .from("chat_sessions")
      .select("id, workspace_name, project_name, created_at")
      .eq("portal_slug", workspace)
      .eq("user_id", user.id)
      .is("deleted_at", null)
      .single();

    if (!session) {
      return NextResponse.json({ error: "Portal not found" }, { status: 404 });
    }

    // Fetch all artifacts for this workspace.
    // Artifacts may be stored with either the scoped ID (usr_xxx:ws_xxx) or
    // the unscoped ID (ws_xxx) depending on when they were created.
    const scopedId = session.id;
    const unscopedId = scopedId.includes(":") ? scopedId.split(":").slice(1).join(":") : scopedId;
    // Try with portal_tab column; fall back without it if column doesn't exist yet
    let artifacts: Record<string, unknown>[] | null = null;
    const { data: withTab, error: tabErr } = await supabase
      .from("artifacts")
      .select("id, file_path, content, status, category, portal_tab, last_generated_at, created_at, updated_at")
      .eq("user_id", user.id)
      .or(`session_id.eq.${scopedId},session_id.eq.${unscopedId},project_id.eq.${scopedId},project_id.eq.${unscopedId}`)
      .order("created_at", { ascending: true });
    if (!tabErr) {
      artifacts = withTab;
    } else {
      // portal_tab column may not exist yet — query without it
      const { data: withoutTab } = await supabase
        .from("artifacts")
        .select("id, file_path, content, status, category, last_generated_at, created_at, updated_at")
        .eq("user_id", user.id)
        .or(`session_id.eq.${scopedId},session_id.eq.${unscopedId},project_id.eq.${scopedId},project_id.eq.${unscopedId}`)
        .order("created_at", { ascending: true });
      artifacts = withoutTab;
    }

    // Fetch branding inputs (logo/icon)
    const { data: brandingInputs } = await supabase
      .from("workspace_inputs")
      .select("file_name, public_url, mime_type")
      .eq("user_id", user.id)
      .or(`session_id.eq.${scopedId},session_id.eq.${unscopedId}`)
      .ilike("file_name", "%logo%,%icon%");

    const logoUrl = brandingInputs?.find((i: { file_name: string }) => i.file_name.toLowerCase().includes("logo") && !i.file_name.toLowerCase().includes("icon"))?.public_url ?? null;
    const iconUrl = brandingInputs?.find((i: { file_name: string }) => i.file_name.toLowerCase().includes("icon"))?.public_url ?? null;

    return NextResponse.json({
      workspace: {
        name: session.workspace_name || session.project_name || "Workspace",
        slug: workspace,
        handle,
        createdAt: session.created_at,
        logoUrl,
        iconUrl,
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      documents: (artifacts ?? []).map((a: any) => ({
        id: a.id,
        filePath: a.file_path,
        content: a.content,
        category: a.category,
        portalTab: a.portal_tab ?? null,
        lastGeneratedAt: a.last_generated_at,
        updatedAt: a.updated_at,
      })),
    });
  } catch (err) {
    console.error("Failed to load portal:", err);
    return NextResponse.json({ error: "Failed to load portal" }, { status: 500 });
  }
}
