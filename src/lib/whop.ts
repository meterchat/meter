import Whop from "@whop/sdk";
import { getSupabaseServer } from "@/lib/supabase";

let _whop: InstanceType<typeof Whop> | null = null;

export function getWhop(): InstanceType<typeof Whop> {
  if (!_whop) {
    if (!process.env.WHOP_API_KEY) {
      throw new Error("WHOP_API_KEY is not set");
    }
    _whop = new Whop({
      apiKey: process.env.WHOP_API_KEY,
      webhookKey: process.env.WHOP_WEBHOOK_KEY
        ? btoa(process.env.WHOP_WEBHOOK_KEY)
        : undefined,
    });
  }
  return _whop;
}

export const WHOP_COMPANY_ID = process.env.WHOP_COMPANY_ID ?? "";

/**
 * Ensure the user has a Whop member ID stored.
 * The member is created when they complete the setup checkout flow.
 * This function just looks it up — if missing, the user needs to save a card first.
 */
export async function ensureWhopMember(userId: string): Promise<{ memberId: string; paymentMethodId: string }> {
  const supabase = getSupabaseServer();

  const { data: user } = await supabase
    .from("meter_users")
    .select("whop_member_id, whop_payment_method_id")
    .eq("id", userId)
    .single();

  if (!user) throw new Error("User not found");

  if (!user.whop_member_id) {
    throw new Error("No payment method on file");
  }

  if (!user.whop_payment_method_id) {
    throw new Error("No payment method on file");
  }

  return {
    memberId: user.whop_member_id,
    paymentMethodId: user.whop_payment_method_id,
  };
}
