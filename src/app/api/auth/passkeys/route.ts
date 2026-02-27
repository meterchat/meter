import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();
    const { data, error } = await supabase
      .from("passkey_credentials")
      .select("credential_id, device_type, backed_up, created_at")
      .eq("user_id", userId);

    if (error) {
      console.error("Passkeys fetch error:", error);
      return NextResponse.json({ passkeys: [] });
    }

    const passkeys = (data ?? []).map((r: Record<string, unknown>) => ({
      credentialId: r.credential_id,
      deviceType: r.device_type ?? null,
      backedUp: r.backed_up ?? false,
      createdAt: r.created_at,
    }));

    return NextResponse.json({ passkeys });
  } catch {
    return NextResponse.json({ passkeys: [] });
  }
}
