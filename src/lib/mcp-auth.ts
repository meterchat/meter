import { NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import crypto from "crypto";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

/**
 * Authenticate an MCP API key from the Authorization header.
 * Returns the user_id or null if invalid.
 * Keys are stored in the `mcp_keys` table (prefix `mk_`).
 */
export async function authenticateMcpKey(req: NextRequest): Promise<string | null> {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer mk_")) return null;

  const apiKey = auth.slice(7); // strip "Bearer "
  const keyHash = hashKey(apiKey);
  const supabase = getSupabaseServer();

  const { data } = await supabase
    .from("mcp_keys")
    .select("id, user_id, active")
    .eq("key_hash", keyHash)
    .single();

  if (!data || !data.active) return null;

  // Fire-and-forget last_used_at update
  supabase
    .from("mcp_keys")
    .update({ last_used_at: new Date().toISOString() })
    .eq("id", data.id)
    .then(() => {});

  return data.user_id;
}
