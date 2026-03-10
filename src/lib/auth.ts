import { NextResponse } from "next/server";
import { getSessionUserId } from "@/lib/session";
import { getSupabaseServer } from "@/lib/supabase";

/**
 * Verify the request is from an authenticated user via session cookie.
 * Returns the userId if valid, or a 401 NextResponse if not.
 */
export async function requireAuth(): Promise<
  { userId: string } | NextResponse
> {
  const userId = await getSessionUserId();
  if (!userId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  return { userId };
}

/**
 * Check if a user has the superadmin account type.
 * Superadmin accounts skip settlement charges and spend limits.
 */
export async function isSuperAdmin(userId: string): Promise<boolean> {
  try {
    const supabase = getSupabaseServer();
    const { data } = await supabase
      .from("meter_users")
      .select("account_type")
      .eq("id", userId)
      .single();
    return data?.account_type === "superadmin";
  } catch {
    return false;
  }
}

/**
 * Verify the request is from an authenticated superadmin.
 * Returns the userId if valid, or a 401/403 NextResponse if not.
 */
export async function requireSuperAdmin(): Promise<
  { userId: string } | NextResponse
> {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const superAdmin = await isSuperAdmin(auth.userId);
  if (!superAdmin) {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return auth;
}
