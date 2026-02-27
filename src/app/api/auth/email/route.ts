import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { getStripe } from "@/lib/stripe";

// POST /api/auth/email — collect email post-authentication (for Stripe receipts)
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

    // If user has a Stripe customer, update their email there too
    const { data: user } = await supabase
      .from("meter_users")
      .select("stripe_customer_id")
      .eq("id", userId)
      .single();

    if (user?.stripe_customer_id) {
      try {
        await getStripe().customers.update(user.stripe_customer_id, {
          email: normalizedEmail,
        });
      } catch {
        // Non-fatal — Stripe email update can fail silently
      }
    }

    return NextResponse.json({ ok: true, email: normalizedEmail });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Email update error:", message);
    return NextResponse.json({ error: "Failed to update email" }, { status: 500 });
  }
}
