import { NextResponse, NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

function mapDecision(d: Record<string, unknown>) {
  return {
    id: d.id,
    title: d.title,
    status: (d.status as string) ?? "undecided",
    archived: (d.archived as boolean) ?? false,
    choice: d.choice ?? undefined,
    alternatives: d.alternatives ?? undefined,
    reasoning: d.reasoning ?? undefined,
    projectId: d.project_id ?? undefined,
    chatMessageId: d.chat_message_id ?? undefined,
    category: d.category ?? undefined,
    parentDecisionId: d.parent_decision_id ?? undefined,
    version: (d.version as number) ?? 1,
    revisitCount: (d.revisit_count as number) ?? 0,
    createdAt: new Date(d.created_at as string).getTime(),
    updatedAt: new Date(d.updated_at as string).getTime(),
  };
}

// GET /api/decisions — load all non-archived decisions for the authenticated user
// GET /api/decisions?history_for=<title>&project_id=<id> — load version history (archived) for a decision title
export async function GET(request: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();
    const { searchParams } = new URL(request.url);
    const historyFor = searchParams.get("history_for");
    const projectId = searchParams.get("project_id");

    // Version history query — returns archived decisions matching title
    if (historyFor) {
      let query = supabase
        .from("decisions")
        .select("*")
        .eq("user_id", userId)
        .eq("title", historyFor)
        .eq("archived", true)
        .order("version", { ascending: false });

      if (projectId) {
        query = query.eq("project_id", projectId);
      }

      const { data, error } = await query;
      if (error) throw error;

      return NextResponse.json({ decisions: (data ?? []).map(mapDecision) });
    }

    // Default: non-archived decisions
    const { data, error } = await supabase
      .from("decisions")
      .select("*")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    return NextResponse.json({ decisions: (data ?? []).map(mapDecision) });
  } catch (err) {
    console.error("Failed to load decisions:", err);
    return NextResponse.json({ error: "Failed to load decisions" }, { status: 500 });
  }
}
