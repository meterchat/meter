import Stripe from "stripe";
import { getSupabaseServer } from "@/lib/supabase";

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) {
      throw new Error("STRIPE_SECRET_KEY is not set");
    }
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  }
  return _stripe;
}

/**
 * Ensure the user has a Stripe customer ID stored.
 * If missing, creates a new Stripe customer and saves the ID.
 */
export async function ensureStripeCustomer(userId: string): Promise<{ customerId: string; paymentMethodId: string | null }> {
  const supabase = getSupabaseServer();

  const { data: user } = await supabase
    .from("meter_users")
    .select("stripe_customer_id, stripe_payment_method_id, email")
    .eq("id", userId)
    .single();

  if (!user) throw new Error("User not found");

  let customerId = user.stripe_customer_id;

  // Clear stale Whop member IDs left over from the migration
  if (customerId && !customerId.startsWith("cus_")) {
    customerId = null;
  }

  if (!customerId) {
    // Create a new Stripe customer
    const stripe = getStripe();
    const customer = await stripe.customers.create({
      email: user.email ?? undefined,
      metadata: { meter_user_id: userId },
    });
    customerId = customer.id;

    await supabase
      .from("meter_users")
      .update({ stripe_customer_id: customerId, updated_at: new Date().toISOString() })
      .eq("id", userId);
  }

  return {
    customerId,
    paymentMethodId: user.stripe_payment_method_id ?? null,
  };
}
