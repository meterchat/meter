import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// GET /api/log/decisions — public locked decisions scoped to a single workspace
// Env vars:
//   METER_FOUNDER_USER_ID  — meter_users.id (e.g. "usr_b582...")
//   METER_WORKSPACE_SESSION_ID — chat_sessions.id for the workspace to display
export async function GET() {
  const userId = process.env.METER_FOUNDER_USER_ID;
  const sessionId = process.env.METER_WORKSPACE_SESSION_ID;

  if (!userId || !sessionId) {
    return NextResponse.json({ decisions: [] });
  }

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("decisions")
      .select("id, title, status, choice, reasoning, category, version, revisit_count, created_at, updated_at")
      .eq("user_id", userId)
      .eq("session_id", sessionId)
      .eq("status", "decided")
      .eq("archived", false)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const decisions = (data ?? []).map((d: Record<string, unknown>) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      choice: d.choice,
      reasoning: d.reasoning,
      category: d.category,
      version: (d.version as number) ?? 1,
      revisitCount: (d.revisit_count as number) ?? 0,
      createdAt: new Date(d.created_at as string).getTime(),
      updatedAt: new Date(d.updated_at as string).getTime(),
    }));

    return NextResponse.json(
      { decisions },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch log decisions:", err);
    return NextResponse.json(
      { error: "Failed to fetch decisions" },
      { status: 500 }
    );
  }
}
