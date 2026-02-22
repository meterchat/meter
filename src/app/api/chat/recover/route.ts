import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/chat/recover?messageId=xxx
 *
 * Returns a message from the DB if the server completed it in the background
 * after the client disconnected mid-stream.
 */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const messageId = req.nextUrl.searchParams.get("messageId");
  if (!messageId) {
    return NextResponse.json({ error: "Missing messageId" }, { status: 400 });
  }

  try {
    const supabase = getSupabaseServer();

    const { data: message, error } = await supabase
      .from("chat_messages")
      .select("id, session_id, content, model, tokens_in, tokens_out, receipt_status, timestamp")
      .eq("id", messageId)
      .single();

    if (error || !message) {
      return NextResponse.json({ message: null });
    }

    // Verify ownership: session IDs are scoped as "userId:projectId"
    const sid = message.session_id as string;
    if (!sid.startsWith(`${userId}:`)) {
      return NextResponse.json({ message: null });
    }

    return NextResponse.json({ message });
  } catch {
    return NextResponse.json({ message: null });
  }
}
