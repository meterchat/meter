import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// Namespace session IDs per user to prevent collisions
function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

function unscopedId(userId: string, dbId: string): string {
  const prefix = `${userId}:`;
  return dbId.startsWith(prefix) ? dbId.slice(prefix.length) : dbId;
}

const DEFAULT_LIMIT = 200;
const MAX_LIMIT = 500;

/**
 * GET /api/sessions/[sessionId]/messages?before=<timestamp>&before_id=<id>&limit=200
 *
 * Cursor-based pagination for chat messages.
 * Returns messages older than the cursor, sorted newest-first (reversed to chronological by client).
 * Also returns aggregate token counts for the full session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { sessionId } = await params;
  const dbSessionId = scopedId(userId, sessionId);

  const searchParams = req.nextUrl.searchParams;
  const before = searchParams.get("before");
  const beforeId = searchParams.get("before_id");
  const limitParam = searchParams.get("limit");
  const limit = Math.min(
    Math.max(1, parseInt(limitParam ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT),
    MAX_LIMIT,
  );

  try {
    const supabase = getSupabaseServer();

    // Verify session belongs to user
    const { data: session, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", dbSessionId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .single();

    if (sessErr || !session) {
      return NextResponse.json({ error: "Session not found" }, { status: 404 });
    }

    // Build paginated query
    let query = supabase
      .from("chat_messages")
      .select("*")
      .eq("session_id", dbSessionId);

    if (before) {
      const beforeTs = parseInt(before, 10);
      if (!isNaN(beforeTs)) {
        if (beforeId) {
          // Compound cursor: (timestamp < before) OR (timestamp = before AND id < before_id)
          query = query.or(
            `timestamp.lt.${beforeTs},and(timestamp.eq.${beforeTs},id.lt.${beforeId})`,
          );
        } else {
          query = query.lt("timestamp", beforeTs);
        }
      }
    }

    // Fetch limit+1 to determine hasMore
    const { data: msgs, error: msgErr } = await query
      .order("timestamp", { ascending: false })
      .order("id", { ascending: false })
      .limit(limit + 1);

    if (msgErr) throw msgErr;

    const rows = (msgs ?? []) as Record<string, unknown>[];
    const hasMore = rows.length > limit;
    const pageRows = hasMore ? rows.slice(0, limit) : rows;

    // Reverse to chronological order
    pageRows.reverse();

    // Get aggregate token counts for the full session
    const { data: agg, error: aggErr } = await supabase
      .from("chat_messages")
      .select("tokens_in, tokens_out")
      .eq("session_id", dbSessionId);

    let totalTokensIn = 0;
    let totalTokensOut = 0;
    let totalMessageCount = 0;
    if (!aggErr && agg) {
      totalMessageCount = agg.length;
      for (const row of agg) {
        totalTokensIn += (row.tokens_in as number) ?? 0;
        totalTokensOut += (row.tokens_out as number) ?? 0;
      }
    }

    const messages = pageRows.map((m) => ({
      ...m,
      session_id: unscopedId(userId, m.session_id as string),
    }));

    return NextResponse.json({
      messages,
      hasMore,
      totalTokensIn,
      totalTokensOut,
      totalMessageCount,
    });
  } catch (err) {
    console.error("Failed to load paginated messages:", err);
    return NextResponse.json(
      { error: "Failed to load messages" },
      { status: 500 },
    );
  }
}
