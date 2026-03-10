import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/artifacts?sessionId=xxx — load all artifacts for the authenticated user + workspace session
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const sessionId = req.nextUrl.searchParams.get("sessionId") ?? req.nextUrl.searchParams.get("projectId") ?? null;

  try {
    const supabase = getSupabaseServer();

    let query = supabase
      .from("artifacts")
      .select("*")
      .eq("user_id", userId);

    if (sessionId) {
      query = query.or(`session_id.eq.${sessionId},project_id.eq.${sessionId}`);
    } else {
      query = query.is("session_id", null).is("project_id", null);
    }

    const { data, error } = await query.order("created_at", { ascending: true });

    if (error) throw error;

    const artifacts = (data ?? []).map((a) => ({
      id: a.id,
      filePath: a.file_path,
      content: a.content,
      status: a.status,
      category: a.category ?? undefined,
      githubRepo: a.github_repo ?? undefined,
      githubSha: a.github_sha ?? undefined,
      lastGeneratedAt: a.last_generated_at ? new Date(a.last_generated_at).getTime() : undefined,
      lastPushedAt: a.last_pushed_at ? new Date(a.last_pushed_at).getTime() : undefined,
      sessionId: a.session_id ?? a.project_id ?? undefined,
    }));

    return NextResponse.json({ artifacts });
  } catch (err) {
    console.error("Failed to load artifacts:", err);
    return NextResponse.json({ error: "Failed to load artifacts" }, { status: 500 });
  }
}
