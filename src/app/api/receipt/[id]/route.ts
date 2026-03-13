import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/receipt/[id]?session=<sessionId>
 *
 * Fetch a single chat message by ID for the receipt page.
 * Scopes the lookup to the authenticated user's session.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { id: messageId } = await params;
  const sessionId = req.nextUrl.searchParams.get("session");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing session param" }, { status: 400 });
  }

  // Namespace session ID per user (same pattern as sessions API)
  const dbSessionId = sessionId.startsWith(`${userId}:`)
    ? sessionId
    : `${userId}:${sessionId}`;

  try {
    const supabase = getSupabaseServer();

    const { data: msg, error } = await supabase
      .from("chat_messages")
      .select("id, role, content, model, tokens_in, tokens_out, cost, confidence, settled, receipt_status, signature, tx_hash, timestamp")
      .eq("id", messageId)
      .eq("session_id", dbSessionId)
      .single();

    if (error || !msg) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    // Verify the session belongs to this user
    const { data: session, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", dbSessionId)
      .eq("user_id", userId)
      .is("deleted_at", null)
      .single();

    if (sessErr || !session) {
      return NextResponse.json({ error: "Message not found" }, { status: 404 });
    }

    return NextResponse.json({ message: msg });
  } catch (err) {
    console.error("Failed to fetch receipt message:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
