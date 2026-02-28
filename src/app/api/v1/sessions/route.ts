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

// GET /api/v1/sessions?endUserId=xxx — list sessions for an end-user
export async function GET(req: NextRequest) {
  const keyRecord = await authenticateApiKey(req);
  if (!keyRecord)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const endUserId = req.nextUrl.searchParams.get("endUserId");
  if (!endUserId)
    return NextResponse.json(
      { error: "endUserId is required" },
      { status: 400 }
    );

  const userId = await resolveEndUser(keyRecord.user_id, endUserId);
  const supabase = getSupabaseServer();

  const { data: sessions } = await supabase
    .from("chat_sessions")
    .select("id, project_name, total_cost, created_at, updated_at")
    .eq("user_id", userId)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false })
    .limit(50);

  return NextResponse.json({ sessions: sessions ?? [] });
}

// POST /api/v1/sessions — create a session for an end-user
export async function POST(req: NextRequest) {
  const keyRecord = await authenticateApiKey(req);
  if (!keyRecord)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endUserId, name } = await req.json();
  if (!endUserId)
    return NextResponse.json(
      { error: "endUserId is required" },
      { status: 400 }
    );

  const userId = await resolveEndUser(keyRecord.user_id, endUserId);
  const supabase = getSupabaseServer();

  const sessionId = `sdk_${Date.now().toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 8)}`;
  const projectName = name || "Chat";

  const { error } = await supabase.from("chat_sessions").insert({
    id: sessionId,
    user_id: userId,
    project_name: projectName,
    developer_id: keyRecord.user_id,
  });

  if (error)
    return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({ sessionId, name: projectName });
}
