import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/artifacts?projectId=xxx — load all artifacts for the authenticated user + project
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const projectId = req.nextUrl.searchParams.get("projectId") || null;

  try {
    const supabase = getSupabaseServer();

    let query = supabase
      .from("artifacts")
      .select("*")
      .eq("user_id", userId);

    if (projectId) {
      query = query.eq("project_id", projectId);
    } else {
      query = query.is("project_id", null);
    }

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) throw error;

    const artifacts = (data ?? []).map((a) => ({
      id: a.id,
      filePath: a.file_path,
      content: a.content,
      status: a.status,
      githubRepo: a.github_repo ?? undefined,
      githubSha: a.github_sha ?? undefined,
      lastGeneratedAt: a.last_generated_at ? new Date(a.last_generated_at).getTime() : undefined,
      lastPushedAt: a.last_pushed_at ? new Date(a.last_pushed_at).getTime() : undefined,
      projectId: a.project_id ?? undefined,
    }));

    return NextResponse.json({ artifacts });
  } catch (err) {
    console.error("Failed to load artifacts:", err);
    return NextResponse.json({ error: "Failed to load artifacts" }, { status: 500 });
  }
}
