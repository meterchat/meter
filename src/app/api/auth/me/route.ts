import { NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getSupabaseServer } from "@/lib/supabase";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";

// Prevent Next.js from caching this route — it must always read fresh from DB
export const dynamic = "force-dynamic";

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
      .select("id, handle, email, account_type, stripe_customer_id, card_last4, card_brand, markup_multiplier, credit_balance")
      .eq("id", userId)
      .single();

    if (error || !user) {
      return NextResponse.json({ error: "User not found" }, { status: 404 });
    }

    // Fetch global admin config (piggyback on auth to avoid extra round-trip)
    const { data: config, error: configError } = await supabase
      .from("app_config")
      .select("markup_multiplier, enabled_models, enabled_commands, free_usd_credit")
      .eq("id", "global")
      .single();

    if (configError) {
      console.warn("[auth/me] Failed to read app_config:", configError.message, configError.code);
    } else {
      console.log("[auth/me] app_config:", JSON.stringify({
        enabled_models: config?.enabled_models,
        enabled_commands: config?.enabled_commands,
        markup_multiplier: config?.markup_multiplier,
      }));
    }

    // Global markup overrides per-user value; fall back to compile-time constant
    const globalMarkup = config ? Number(config.markup_multiplier) : DEFAULT_MARKUP_MULTIPLIER;

    const res = NextResponse.json({
      userId: user.id,
      handle: user.handle ?? null,
      email: user.email ?? null,
      accountType: user.account_type ?? "standard",
      stripeCustomerId: user.stripe_customer_id ?? null,
      cardOnFile: !!(user.stripe_customer_id && user.card_last4),
      cardLast4: user.card_last4 ?? null,
      cardBrand: user.card_brand ?? null,
      markupMultiplier: globalMarkup,
      creditBalance: Number(user.credit_balance ?? 0),
      adminConfig: {
        enabledModels: config?.enabled_models ?? [],
        enabledCommands: config?.enabled_commands ?? [],
      },
    });
    res.headers.set("Cache-Control", "no-store");
    return res;
  } catch (err) {
    console.error("Failed to load user profile:", err);
    return NextResponse.json({ error: "Failed to load profile" }, { status: 500 });
  }
}
