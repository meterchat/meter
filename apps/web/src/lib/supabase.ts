import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Browser client — uses anon key, respects RLS
export function getSupabaseBrowser() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) throw new Error("Missing Supabase env vars");
  return createClient(url, key);
}

// Server client — uses service role key, bypasses RLS
export function getSupabaseServer() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error("Missing Supabase server env vars");
  return createClient(url, key);
}

// Set RLS context for anon-key queries (service_role bypasses RLS automatically)
export async function setRLSContext(supabase: SupabaseClient, userId: string) {
  await supabase.rpc("set_app_user", { p_user_id: userId });
}
