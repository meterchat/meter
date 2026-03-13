import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";

/**
 * GET /api/auth/me
 * Returns the authenticated user's profile data from the database.
 * Used on page refresh to restore user state that may not be in localStorage.
 */
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();
    const { data: user, error } = await supabase
      .from("meter_users")
      .select("id, handle, email, account_type, stripe_customer_id, card_last4, card_brand, markup_multiplier, free_credit_remaining")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch global admin config (piggyback on auth to avoid extra round-trip)
    const { data: config } = await supabase
      .from("app_config")
      .select("markup_multiplier, enabled_models, enabled_commands, free_usd_credit")
      .eq("id", "global")
      .single();

    // Global markup overrides per-user value; fall back to compile-time constant
    const globalMarkup = config ? Number(config.markup_multiplier) : DEFAULT_MARKUP_MULTIPLIER;

    return NextResponse.json({
      userId: user.id,
      handle: user.handle ?? null,
      email: user.email ?? null,
      accountType: user.account_type ?? "standard",
      stripeCustomerId: user.stripe_customer_id ?? null,
      cardOnFile: !!(user.stripe_customer_id && user.card_last4),
      cardLast4: user.card_last4 ?? null,
      cardBrand: user.card_brand ?? null,
      markupMultiplier: globalMarkup,
      freeCredit: Number(user.free_credit_remaining ?? 0),
      adminConfig: {
        enabledModels: config?.enabled_models ?? [],
        enabledCommands: config?.enabled_commands ?? [],
      },
    });
  } catch (err) {
    console.error("Failed to load user profile:", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}
