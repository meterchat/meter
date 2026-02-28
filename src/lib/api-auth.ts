import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import crypto from "crypto";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Authenticate an API key from the Authorization header.
 * Returns the key record (id, user_id, active) or null if invalid.
 *
 * Updates `last_used_at` in the background (fire-and-forget).
 */
export async function authenticateApiKey(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer mk_")) return null;

  const apiKey = auth.slice(7); // strip "Bearer "
  const keyHash = hashKey(apiKey);
  const supabase = getSupabaseServer();

  const { data } = await supabase
    .from("api_keys")
    .select("id, user_id, active")
    .eq("key_hash", keyHash)
    .single();

  if (!data || !data.active) return null;

  // Fire-and-forget — don't block the request
  supabase
    .from("api_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return data;
}
