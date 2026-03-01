import { getSupabaseServer } from "@/lib/supabase";
import crypto from "crypto";

/**
 * Resolve an SDK end-user to an internal Meter user ID.
 * Creates the record on first use via upsert (single round-trip).
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
  const id = `seu_${crypto.randomBytes(12).toString("hex")}`;

  const { data, error } = await supabase
    .from("sdk_end_users")
    .upsert(
      { id, developer_id: developerId, external_user_id: externalUserId },
      { onConflict: "developer_id,external_user_id", ignoreDuplicates: true }
    )
    .select("id")
    .single();

  if (data) return data.id;

  // If upsert returned no rows (ignoreDuplicates), fetch existing
  if (!data) {
    const { data: existing } = await supabase
      .from("sdk_end_users")
      .select("id")
      .eq("developer_id", developerId)
      .eq("external_user_id", externalUserId)
      .single();
    if (existing) return existing.id;
  }

  throw new Error(`Failed to resolve SDK end-user: ${error?.message ?? "unknown"}`);
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
