import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireSuperAdmin } from "@/lib/auth";

/**
 * GET /api/debug-sessions — Diagnostic endpoint to audit all sessions (superadmin only).
 * Returns a summary of every session with message counts, date ranges,
 * and relationship metadata (is_subtrack, parent_session_id, workspace_name).
 *
 * This helps diagnose issues where messages ended up in the wrong session
 * or phantom workspaces were created from track sessions.
 */
export async function GET() {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();

    // Get all sessions (including soft-deleted ones for completeness)
    const { data: sessions, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: true });

    if (sessErr) throw sessErr;

    const prefix = `${userId}:`;
    function unscope(id: string) {
      return id.startsWith(prefix) ? id.slice(prefix.length) : id;
    }

    const results = [];

    for (const s of sessions ?? []) {
      // Get message count and date range
      const { count } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", s.id);

      // Get first and last message timestamps
      const { data: firstMsg } = await supabase
        .from("chat_messages")
        .select("id, role, timestamp, content")
        .eq("session_id", s.id)
        .order("timestamp", { ascending: true })
        .limit(1);

      const { data: lastMsg } = await supabase
        .from("chat_messages")
        .select("id, role, timestamp, content")
        .eq("session_id", s.id)
        .order("timestamp", { ascending: false })
        .limit(1);

      // Get first 3 user messages to help identify the session
      const { data: sampleMsgs } = await supabase
        .from("chat_messages")
        .select("id, role, content, timestamp")
        .eq("session_id", s.id)
        .eq("role", "user")
        .order("timestamp", { ascending: true })
        .limit(3);

      // Count messages by role
      const { count: userMsgCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", s.id)
        .eq("role", "user");

      const { count: assistantMsgCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", s.id)
        .eq("role", "assistant");

      results.push({
        id: unscope(s.id),
        scopedId: s.id,
        name: s.workspace_name || s.project_name,
        projectName: s.project_name,
        workspaceName: s.workspace_name,
        isSubtrack: s.is_subtrack ?? false,
        parentSessionId: s.parent_session_id ? unscope(s.parent_session_id) : null,
        totalCost: s.total_cost,
        createdAt: s.created_at,
        updatedAt: s.updated_at,
        deletedAt: s.deleted_at,
        messageCount: count ?? 0,
        userMessages: userMsgCount ?? 0,
        assistantMessages: assistantMsgCount ?? 0,
        firstMessage: firstMsg?.[0] ? {
          id: firstMsg[0].id,
          role: firstMsg[0].role,
          timestamp: firstMsg[0].timestamp,
          preview: (firstMsg[0].content as string)?.slice(0, 100),
        } : null,
        lastMessage: lastMsg?.[0] ? {
          id: lastMsg[0].id,
          role: lastMsg[0].role,
          timestamp: lastMsg[0].timestamp,
          preview: (lastMsg[0].content as string)?.slice(0, 100),
        } : null,
        sampleUserMessages: (sampleMsgs ?? []).map((m) => ({
          id: m.id,
          timestamp: m.timestamp,
          preview: (m.content as string)?.slice(0, 150),
        })),
      });
    }

    // Also check for orphaned messages (messages whose session_id doesn't match any session)
    // This would catch messages that were reassigned by the upsert bug
    const allSessionIds = (sessions ?? []).map((s) => s.id);

    return NextResponse.json({
      userId,
      totalSessions: results.length,
      activeSessions: results.filter((r) => !r.deletedAt).length,
      deletedSessions: results.filter((r) => r.deletedAt).length,
      subtracks: results.filter((r) => r.isSubtrack).length,
      sessions: results,
    });
  } catch (err) {
    console.error("Debug sessions error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
