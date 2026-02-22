import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// Namespace session IDs per user to prevent collisions
// (e.g. all users start with session id "meter")
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
      .order("created_at", { ascending: true });

    if (sessErr) throw sessErr;

    // Load messages for each session
    const sessionIds = (sessions ?? []).map((s) => s.id);
    const { data: messages, error: msgErr } = sessionIds.length
      ? await supabase
          .from("chat_messages")
          .select("*")
          .in("session_id", sessionIds)
          .order("timestamp", { ascending: true })
      : { data: [], error: null };

    if (msgErr) throw msgErr;

    // Group messages by session
    const allMessages = (messages ?? []) as Record<string, unknown>[];
    const messagesBySession: Record<string, Record<string, unknown>[]> = {};
    for (const msg of allMessages) {
      const sid = msg.session_id as string;
      if (!messagesBySession[sid]) messagesBySession[sid] = [];
      messagesBySession[sid].push(msg);
    }

    // Return sessions with unscoped IDs so the client sees its original local IDs
    const result = (sessions ?? []).map((s) => ({
      ...s,
      id: unscopedId(userId, s.id),
      messages: (messagesBySession[s.id] ?? []).map((m) => ({
        ...m,
        session_id: unscopedId(userId, m.session_id as string),
      })),
    }));

    return NextResponse.json({ sessions: result });
  } catch (err) {
    console.error("Failed to load sessions:", err);
    return NextResponse.json({ error: "Failed to load sessions" }, { status: 500 });
  }
}

// DELETE /api/sessions?sessionId=xxx — delete a session and its messages
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

    const actualId = session.id;

    // Delete messages first (cascade should handle this, but be explicit)
    await supabase.from("chat_messages").delete().eq("session_id", actualId);

    // Delete the session
    const { error: delErr } = await supabase
      .from("chat_sessions")
      .delete()
      .eq("id", actualId)
      .eq("user_id", userId);

    if (delErr) throw delErr;

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
    const { error: sessErr } = await supabase.from("chat_sessions").upsert(
      {
        id: dbSessionId,
        user_id: userId,
        project_name: session.name,
        total_cost: session.totalCost ?? 0,
        today_cost: session.todayCost ?? 0,
        today_tokens_in: session.todayTokensIn ?? 0,
        today_tokens_out: session.todayTokensOut ?? 0,
        today_message_count: session.todayMessageCount ?? 0,
        today_date: session.todayDate,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "id" }
    );

    if (sessErr) throw sessErr;

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
        cost: m.cost ?? null,
        confidence: m.confidence ?? null,
        settled: m.settled ?? false,
        receipt_status: m.receiptStatus ?? null,
        signature: m.signature ?? null,
        tx_hash: m.txHash ?? null,
        cards: m.cards ?? null,
        timestamp: m.timestamp,
      }));

      // Batch upsert in chunks of 100
      for (let i = 0; i < rows.length; i += 100) {
        const chunk = rows.slice(i, i + 100);
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
