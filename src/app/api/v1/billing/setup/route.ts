import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { resolveEndUser } from "@/lib/sdk-users";
import { authenticateApiKey } from "@/lib/api-auth";
import { getStripe } from "@/lib/stripe-billing";

// POST /api/v1/billing/setup — create Stripe SetupIntent for end-user card
export async function POST(req: NextRequest) {
  const keyRecord = await authenticateApiKey(req);
  if (!keyRecord)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { endUserId } = await req.json();
  if (!endUserId)
    return NextResponse.json(
      { error: "endUserId is required" },
      { status: 400 }
    );

  const internalId = await resolveEndUser(keyRecord.user_id, endUserId);

  // Ensure the SDK end user has a Stripe customer
  const supabase = getSupabaseServer();
  const { data: endUser } = await supabase
    .from("sdk_end_users")
    .select("stripe_customer_id, email")
    .eq("id", internalId)
    .single();

  const stripe = getStripe();
  let customerId = endUser?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
      email: endUser?.email ?? undefined,
      metadata: {
        meter_sdk_user_id: internalId,
        developer_id: keyRecord.user_id,
        external_user_id: endUserId,
      },
    });
    customerId = customer.id;

    await supabase
      .from("sdk_end_users")
      .update({ stripe_customer_id: customerId })
      .eq("id", internalId);
  }

  const setupIntent = await stripe.setupIntents.create({
    customer: customerId,
    payment_method_types: ["card", "apple_pay"],
    metadata: {
      meter_sdk_user_id: internalId,
      developer_id: keyRecord.user_id,
      external_user_id: endUserId,
    },
  });

  return NextResponse.json({
    clientSecret: setupIntent.client_secret,
  });
}
