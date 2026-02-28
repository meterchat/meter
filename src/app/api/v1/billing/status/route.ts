import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { resolveEndUser, getEndUserBillingStatus } from "@/lib/sdk-users";
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

// GET /api/v1/billing/status?endUserId=xxx — check if end-user has card on file
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

  const internalId = await resolveEndUser(keyRecord.user_id, endUserId);
  const status = await getEndUserBillingStatus(internalId);

  return NextResponse.json(status);
}
