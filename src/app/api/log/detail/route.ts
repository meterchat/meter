import { NextResponse, NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// GET /api/log/detail?id=xxx — enrich a log entry with related data
export async function GET(request: NextRequest) {
  try {
    const supabase = getSupabaseServer();
    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json({ error: "Missing id" }, { status: 400 });
    }

    // Fetch the log entry
    const { data: entry, error } = await supabase
      .from("log_entries")
      .select("id, type, actor, commit_sha, commit_url, commit_repo, commit_message, feedback_text, created_at")
      .eq("id", id)
      .single();

    if (error || !entry) {
      return NextResponse.json({ error: "Entry not found" }, { status: 404 });
    }

    const enrichment: Record<string, unknown> = {};

    // For message_sent — find the nearest user message in chat_messages
    if (entry.type === "message_sent" && entry.created_at) {
      const ts = new Date(entry.created_at as string);
      const before = new Date(ts.getTime() - 5000).toISOString();
      const after = new Date(ts.getTime() + 5000).toISOString();

      const { data: messages } = await supabase
        .from("chat_messages")
        .select("id, role, content, model, cost, tokens_in, tokens_out, created_at")
        .eq("role", "user")
        .gte("created_at", before)
        .lte("created_at", after)
        .order("created_at", { ascending: false })
        .limit(1);

      if (messages && messages.length > 0) {
        enrichment.userMessage = messages[0];
      }
    }

    // For debate_started — find the nearest debate assistant message
    if (entry.type === "debate_started" && entry.created_at) {
      const ts = new Date(entry.created_at as string);
      const after = new Date(ts.getTime() - 5000).toISOString();
      const later = new Date(ts.getTime() + 300000).toISOString(); // debates take a while

      const { data: messages } = await supabase
        .from("chat_messages")
        .select("id, role, content, model, cost, tokens_in, tokens_out, debate_trace, created_at")
        .eq("model", "debate")
        .eq("role", "assistant")
        .gte("created_at", after)
        .lte("created_at", later)
        .order("created_at", { ascending: true })
        .limit(1);

      if (messages && messages.length > 0) {
        enrichment.debateMessage = messages[0];
      }
    }

    // For decision_locked — find related decision
    if (entry.type === "decision_locked" && entry.created_at) {
      const ts = new Date(entry.created_at as string);
      const before = new Date(ts.getTime() - 10000).toISOString();
      const after = new Date(ts.getTime() + 10000).toISOString();

      const { data: decisions } = await supabase
        .from("decisions")
        .select("id, title, choice, reasoning, category")
        .gte("updated_at", before)
        .lte("updated_at", after)
        .limit(1);

      if (decisions && decisions.length > 0) {
        enrichment.decision = decisions[0];
      }
    }

    return NextResponse.json({ entry, enrichment });
  } catch (err) {
    console.error("Failed to fetch log detail:", err);
    return NextResponse.json({ error: "Failed to fetch detail" }, { status: 500 });
  }
}
