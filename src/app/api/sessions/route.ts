import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { serverTrackSessionCreated, serverTrackSessionDeleted } from "@/lib/analytics-server";
import { generatePortalSlug } from "@/lib/portal-slug";

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

    // Fetch messages + aggregates in parallel per session for speed.
    await Promise.all((sessions ?? []).map(async (session) => {
      // Fetch recent messages (limit+1 to check hasMore)
      const [msgsResult, statsResult] = await Promise.all([
        supabase
          .from("chat_messages")
          .select("*")
          .eq("session_id", session.id)
          .order("timestamp", { ascending: false })
          .limit(INITIAL_MESSAGE_LIMIT + 1),

        // Single SQL aggregate instead of paginating through all messages
        supabase.rpc("get_session_message_stats", { p_session_id: session.id }).single(),
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

// POST /api/sessions — save/sync a session with its messages
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    const { session, messages } = body;

    if (!session) {
      return NextResponse.json({ error: "Missing session" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const dbSessionId = scopedId(userId, session.id);
    const clientHasMessages = Array.isArray(messages) && messages.length > 0;

    // Upsert the session with scoped ID
    const upsertData: Record<string, unknown> = {
      id: dbSessionId,
      user_id: userId,
      updated_at: new Date().toISOString(),
    };
    // Only include fields that were explicitly provided — avoids overwriting
    // server-side totals with 0/undefined on metadata-only saves.
    if (session.name != null) { upsertData.project_name = session.name; upsertData.workspace_name = session.name; }
    if (session.totalCost != null) upsertData.total_cost = session.totalCost;
    if (session.todayCost != null) upsertData.today_cost = session.todayCost;
    if (session.todayTokensIn != null) upsertData.today_tokens_in = session.todayTokensIn;
    if (session.todayTokensOut != null) upsertData.today_tokens_out = session.todayTokensOut;
    if (session.todayMessageCount != null) upsertData.today_message_count = session.todayMessageCount;
    if (session.todayDate != null) upsertData.today_date = session.todayDate;
    // Track vs workspace distinction
    if (session.isSubtrack != null) upsertData.is_subtrack = session.isSubtrack;
    if (session.parentSessionId != null) upsertData.parent_session_id = scopedId(userId, session.parentSessionId);
    if (session.forkMessageId != null) upsertData.fork_message_id = session.forkMessageId;
    // Persist week/month cost data if provided (columns may not exist yet)
    if (session.weekCost != null) upsertData.week_cost = session.weekCost;
    if (session.weekKey != null) upsertData.week_key = session.weekKey;
    if (session.monthCost != null) upsertData.month_cost = session.monthCost;
    if (session.monthKey != null) upsertData.month_key = session.monthKey;
    // Track lifecycle state
    if (session.archived != null) upsertData.archived = session.archived;
    if (session.committed != null) upsertData.committed = session.committed;

    const { error: sessErr } = await supabase.from("chat_sessions").upsert(
      upsertData,
      { onConflict: "id" }
    );
    if (sessErr) throw sessErr;

    // Track session creation (first sync only — no messages means new session)
    if (!clientHasMessages) {
      serverTrackSessionCreated(userId, {
        sessionId: session.id,
        projectName: session.name,
      });

      // Auto-generate portal slug for new workspaces (not subtracks)
      if (!session.isSubtrack) {
        try {
          const slug = generatePortalSlug(session.name || "workspace");
          await supabase
            .from("chat_sessions")
            .update({ portal_slug: slug })
            .eq("id", dbSessionId);
        } catch {
          // Non-critical — slug can be generated later via /api/portal
        }
      }
    }

    // Upsert messages in batches
    if (clientHasMessages) {
      const rows = messages.map((m: Record<string, unknown>) => ({
        id: m.id,
        session_id: dbSessionId,
        role: m.role,
        content: m.content ?? "",
        model: m.model ?? null,
        tokens_in: m.tokensIn ?? null,
        tokens_out: m.tokensOut ?? null,
        cache_creation_tokens: m.cacheCreationTokens ?? null,
        cache_read_tokens: m.cacheReadTokens ?? null,
        cache_read_rate: m.cacheReadRate ?? null,
        cost: m.cost ?? null,
        confidence: m.confidence ?? null,
        settled: m.settled ?? false,
        receipt_status: m.receiptStatus ?? null,
        cards: m.cards ?? null,
        attachments: m.attachments ?? null,
        debate_trace: m.debateTrace ?? null,
        dissector_trace: m.dissectorTrace ?? null,
        simplifier_trace: m.simplifierTrace ?? null,
        documents: m.documents ?? null,
        thinking: m.thinking ?? null,
        timestamp: m.timestamp,
        is_fork_point: m.isForkPoint ?? null,
        fork_resolution: m.forkResolution ?? null,
        pinned: m.pinned ?? false,
        decision_id: m.decisionId ?? null,
        hidden: m.hidden ?? false,
        clarifying_questions: m.clarifyingQuestions ?? null,
      }));

      // Guard: don't let a stale "metering" upsert overwrite a "metered" row.
      // This prevents the race where sendBeacon or periodic sync arrives after
      // the server-side chat route has already saved the completed response.
      const meteringIds = rows
        .filter((r: Record<string, unknown>) => r.receipt_status === "metering")
        .map((r: Record<string, unknown>) => r.id as string);

      let alreadyMeteredIds = new Set<string>();
      if (meteringIds.length > 0) {
        const { data: meteredRows } = await supabase
          .from("chat_messages")
          .select("id")
          .in("id", meteringIds)
          .in("receipt_status", ["metered", "settled"]);
        if (meteredRows) {
          alreadyMeteredIds = new Set(meteredRows.map((r: { id: string }) => r.id));
        }
      }

      const filteredRows = alreadyMeteredIds.size > 0
        ? rows.filter((r: Record<string, unknown>) =>
            !(r.receipt_status === "metering" && alreadyMeteredIds.has(r.id as string))
          )
        : rows;

      // Batch upsert in chunks of 100
      for (let i = 0; i < filteredRows.length; i += 100) {
        const chunk = filteredRows.slice(i, i + 100);
        const { error: msgErr } = await supabase
          .from("chat_messages")
          .upsert(chunk, { onConflict: "id" });
        if (msgErr) throw msgErr;
      }
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to save session:", err);
    return NextResponse.json({ error: "Failed to save session" }, { status: 500 });
  }
}
