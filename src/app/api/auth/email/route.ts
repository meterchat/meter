import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// POST /api/auth/email — collect email post-authentication (for receipts)
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { email } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!normalizedEmail.includes("@")) {
      return NextResponse.json({ error: "Invalid email" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Check uniqueness
    const { data: existing } = await supabase
      .from("meter_users")
      .select("id")
      .eq("email", normalizedEmail)
      .single();

    if (existing && existing.id !== userId) {
      return NextResponse.json({ error: "Email already in use" }, { status: 409 });
    }

    // Update user email
    const { error: updateErr } = await supabase
      .from("meter_users")
      .update({ email: normalizedEmail, updated_at: new Date().toISOString() })
      .eq("id", userId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true, email: normalizedEmail });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Email update error:", message);
    return NextResponse.json({ error: "Failed to update email" }, { status: 500 });
  }
}
