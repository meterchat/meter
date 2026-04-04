import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { serverTrackSessionDeleted } from "@/lib/analytics-server";

// Namespace session IDs per user to prevent collisions
function scopedId(userId: string, localId: string): string {
  // Already scoped — don't double-prefix
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

function unscopedId(userId: string, dbId: string): string {
  const prefix = `${userId}:`;
  return dbId.startsWith(prefix) ? dbId.slice(prefix.length) : dbId;
}

// GET /api/sessions — load all sessions + messages for the authenticated user
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();

    const { data: sessions, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("*")
      .eq("user_id", userId)
      .is("deleted_at", null)
      .order("created_at", { ascending: true });

    if (sessErr) throw sessErr;

    // Load only the most recent 20 messages per session for instant display.
    // Older messages are loaded progressively via paginated endpoint.
    const INITIAL_MESSAGE_LIMIT = 20;
    const messagesBySession: Record<string, Record<string, unknown>[]> = {};
    const aggregatesBySession: Record<string, { totalTokensIn: number; totalTokensOut: number; totalMessageCount: number; pendingBalance: number; hasMore: boolean }> = {};
    const activeRunsBySession: Record<string, Record<string, unknown>[]> = {};

    // Fetch messages + aggregates in parallel per session for speed.
    await Promise.all((sessions ?? []).map(async (session) => {
      // Fetch recent messages (limit+1 to check hasMore)
      const [msgsResult, statsResult, runsResult] = await Promise.all([
        supabase
          .from("chat_messages")
          .select("*")
          .eq("session_id", session.id)
          .order("timestamp", { ascending: false })
          .limit(INITIAL_MESSAGE_LIMIT + 1),

        // Single SQL aggregate instead of paginating through all messages
        supabase.rpc("get_session_message_stats", { p_session_id: session.id }).single(),

        // Fetch active runs (streaming or created) for this session
        supabase
          .from("chat_runs")
          .select("id, status, assistant_message_id, last_chunk_at")
          .eq("session_id", session.id)
          .in("status", ["created", "streaming"])
          .is("finalized_at", null),
      ]);

      if (msgsResult.error) throw msgsResult.error;

      const rows = (msgsResult.data ?? []) as Record<string, unknown>[];
      const hasMore = rows.length > INITIAL_MESSAGE_LIMIT;
      const pageRows = hasMore ? rows.slice(0, INITIAL_MESSAGE_LIMIT) : rows;
      pageRows.reverse();
      messagesBySession[session.id] = pageRows;

      // Use RPC stats if available, fall back to zeros
      const stats = statsResult.data as Record<string, unknown> | null;
      aggregatesBySession[session.id] = {
        totalTokensIn: Number(stats?.total_tokens_in ?? 0),
        totalTokensOut: Number(stats?.total_tokens_out ?? 0),
        totalMessageCount: Number(stats?.total_message_count ?? 0),
        pendingBalance: Number(stats?.pending_balance ?? 0),
        hasMore,
      };

      // Store active runs for this session (log query errors but don't fail the whole response)
      if (runsResult.error) {
        console.warn(`[sessions] Failed to fetch active runs for ${session.id}:`, runsResult.error);
      }
      const activeRuns = (runsResult.error ? [] : runsResult.data ?? []) as Record<string, unknown>[];
      activeRunsBySession[session.id] = activeRuns;
    }));

    // Return sessions with unscoped IDs so the client sees its original local IDs
    const result = (sessions ?? []).map((s) => {
      const agg = aggregatesBySession[s.id] ?? { totalTokensIn: 0, totalTokensOut: 0, totalMessageCount: 0, hasMore: false };
      return {
        ...s,
        id: unscopedId(userId, s.id),
        // Include subtrack metadata so client can distinguish tracks from workspaces
        is_subtrack: s.is_subtrack ?? false,
        parent_session_id: s.parent_session_id ? unscopedId(userId, s.parent_session_id) : null,
        messages: (messagesBySession[s.id] ?? []).map((m) => ({
          ...m,
          session_id: unscopedId(userId, m.session_id as string),
        })),
        total_tokens_in: agg.totalTokensIn,
        total_tokens_out: agg.totalTokensOut,
        total_message_count: agg.totalMessageCount,
        pending_balance: agg.pendingBalance,
        has_more_messages: agg.hasMore,
        active_runs: (activeRunsBySession[s.id] ?? []).map((r) => ({
          id: r.id,
          status: r.status,
          assistant_message_id: r.assistant_message_id,
          last_chunk_at: r.last_chunk_at,
        })),
      };
    });

    return NextResponse.json({ sessions: result });
  } catch (err) {
    console.error("Failed to load sessions:", err);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}

// DELETE /api/sessions?sessionId=xxx — soft-delete a session (retained 7 days)
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const localSessionId = req.nextUrl.searchParams.get("sessionId");

  if (!localSessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const dbId = scopedId(userId, localSessionId);

  try {
    const supabase = getSupabaseServer();

    const { data: session, error: fetchErr } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", dbId)
      .eq("user_id", userId)
      .single();

    if (fetchErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Soft-delete: set deleted_at timestamp, data retained 7 days
    const { error: delErr } = await supabase
      .from("chat_sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", session.id)
      .eq("user_id", userId);

    if (delErr) throw delErr;

    serverTrackSessionDeleted(userId, { sessionId: localSessionId });

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete session:", err);
    return NextResponse.json({ error: "Failed to delete session" }, { status: 500 });
  }
}
