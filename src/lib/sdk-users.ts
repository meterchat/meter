import { getSupabaseServer } from "@/lib/supabase";
import crypto from "crypto";

/**
 * Resolve an SDK end-user to an internal Meter user ID.
 * Creates the record on first use (upsert pattern).
 *
 * @param developerId - UUID of the developer (from api_keys.user_id)
 * @param externalUserId - The developer's user ID (opaque string)
 * @returns Internal sdk_end_users.id
 */
export async function resolveEndUser(
  developerId: string,
  externalUserId: string
): Promise<string> {
  const supabase = getSupabaseServer();

  // Try to find existing mapping
  const { data: existing } = await supabase
    .from("sdk_end_users")
    .select("id")
    .eq("developer_id", developerId)
    .eq("external_user_id", externalUserId)
    .single();

  if (existing) return existing.id;

  // Create new mapping
  const id = `seu_${crypto.randomBytes(12).toString("hex")}`;
  const { error } = await supabase.from("sdk_end_users").insert({
    id,
    developer_id: developerId,
    external_user_id: externalUserId,
  });

  // Handle race condition: another request created the record first
  if (error?.code === "23505") {
    const { data: raced } = await supabase
      .from("sdk_end_users")
      .select("id")
      .eq("developer_id", developerId)
      .eq("external_user_id", externalUserId)
      .single();
    if (raced) return raced.id;
  }

  if (error) throw new Error(`Failed to create SDK end-user: ${error.message}`);
  return id;
}

/**
 * Get billing status for an SDK end-user.
 */
export async function getEndUserBillingStatus(endUserId: string) {
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("sdk_end_users")
    .select("stripe_customer_id, card_last4, card_brand, markup_multiplier")
    .eq("id", endUserId)
    .single();

  return {
    cardOnFile: !!(data?.stripe_customer_id && data?.card_last4),
    cardLast4: data?.card_last4 ?? null,
    cardBrand: data?.card_brand ?? null,
    markupMultiplier: Number(data?.markup_multiplier ?? 1),
  };
}
