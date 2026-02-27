import Stripe from "stripe";
import { getSupabaseServer } from "@/lib/supabase";

if (!process.env.STRIPE_SECRET_KEY) {
  throw new Error("STRIPE_SECRET_KEY is not set");
}

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY, {
  apiVersion: "2026-01-28.clover",
  typescript: true,
});

/**
 * Ensure the user has a valid Stripe customer in the CURRENT Stripe account.
 * If the stored customer ID is stale (e.g. after switching Stripe accounts),
 * creates a new customer and updates the DB.
 */
export async function ensureStripeCustomer(userId: string): Promise<string> {
  const supabase = getSupabaseServer();

  const { data: user } = await supabase
    .from("meter_users")
    .select("email, stripe_customer_id")
    .eq("id", userId)
    .single();

  if (!user) throw new Error("User not found");

  // If we have an existing customer ID, verify it's valid
  if (user.stripe_customer_id) {
    try {
      const customer = await stripe.customers.retrieve(user.stripe_customer_id);
      if (!customer.deleted) return user.stripe_customer_id;
    } catch (err) {
      const msg = err instanceof Error ? err.message : "";
      if (!msg.includes("No such customer") && !msg.includes("resource_missing")) {
        throw err; // unexpected error — don't swallow
      }
      // Customer doesn't exist in this Stripe account — fall through to create
    }
  }

  // Create new customer
  const customer = await stripe.customers.create({
    ...(user.email ? { email: user.email } : {}),
    metadata: { meter_user_id: userId },
  });

  await supabase
    .from("meter_users")
    .update({ stripe_customer_id: customer.id })
    .eq("id", userId);

  return customer.id;
}
