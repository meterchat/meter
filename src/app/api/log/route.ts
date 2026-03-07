import { NextResponse, NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const VALID_TYPES = [
  "message_sent",
  "decision_locked",
  "debate_started",
  "path_forked",
  "path_merged",
  "workspace_created",
  "feedback_logged",
  "commit_pushed",
] as const;

// POST /api/log — create a log entry (no auth required)
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { type, actor, feedbackText } = body;

    if (!type || !VALID_TYPES.includes(type)) {
      return NextResponse.json({ error: "Invalid type" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { error } = await supabase.from("log_entries").insert({
      id: generateId(),
      type,
      actor: actor || "anon",
      feedback_text: type === "feedback_logged" ? feedbackText : null,
    });

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to create log entry:", err);
    return NextResponse.json(
      { error: "Failed to create log entry" },
      { status: 500 }
    );
  }
}

// GET /api/log — public feed of log entries
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const { searchParams } = new URL(request.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "100"), 500);
    const before = searchParams.get("before"); // cursor-based pagination

    let query = supabase
      .from("log_entries")
      .select("id, type, actor, commit_sha, commit_url, commit_repo, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (before) {
      query = query.lt("created_at", before);
    }

    const { data, error } = await query;
    if (error) throw error;

    return NextResponse.json(
      { entries: data ?? [] },
      {
        headers: {
          "Cache-Control": "public, s-maxage=10, stale-while-revalidate=30",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch log entries:", err);
    return NextResponse.json(
      { error: "Failed to fetch log entries" },
      { status: 500 }
    );
  }
}
