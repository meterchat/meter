import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { resolveEndUser } from "@/lib/sdk-users";
import crypto from "crypto";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

async function authenticateApiKey(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer mk_")) return null;
  const apiKey = auth.slice(7);
  const keyHash = hashKey(apiKey);
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("api_keys")
    .select("id, user_id, active")
    .eq("key_hash", keyHash)
    .single();
  if (!data || !data.active) return null;
  return data;
}

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

  // Verify session ownership
  const { data: session } = await supabase
    .from("chat_sessions")
    .select("id")
    .eq("id", sessionId)
    .eq("user_id", userId)
    .single();

  if (!session)
    return NextResponse.json({ error: "Session not found" }, { status: 404 });

  const { data: messages } = await supabase
    .from("chat_messages")
    .select("id, role, content, model, tokens_in, tokens_out, cost, timestamp")
    .eq("session_id", sessionId)
    .order("timestamp", { ascending: true });

  return NextResponse.json({ messages: messages ?? [] });
}
