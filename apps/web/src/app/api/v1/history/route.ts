import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { resolveEndUser } from "@/lib/sdk-users";
import { authenticateApiKey } from "@/lib/api-auth";

// GET /api/v1/history?endUserId=xxx&sessionId=yyy — get messages for a session
export async function GET(req: NextRequest) {
  const keyRecord = await authenticateApiKey(req);
  if (!keyRecord)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const endUserId = req.nextUrl.searchParams.get("endUserId");
  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!endUserId || !sessionId)
    return NextResponse.json(
      { error: "endUserId and sessionId are required" },
      { status: 400 }
    );

  const userId = await resolveEndUser(keyRecord.user_id, endUserId);
  const supabase = getSupabaseServer();

  // Run both queries in parallel — check session ownership + fetch messages
  const [sessionResult, messagesResult] = await Promise.all([
    supabase
      .from("chat_sessions")
      .select("id")
      .eq("id", sessionId)
      .eq("user_id", userId)
      .single(),
    supabase
      .from("chat_messages")
      .select("id, role, content, model, tokens_in, tokens_out, cost, timestamp")
      .eq("session_id", sessionId)
      .order("timestamp", { ascending: true }),
  ]);

  if (!sessionResult.data)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });

  return NextResponse.json({ messages: messagesResult.data ?? [] });
}
