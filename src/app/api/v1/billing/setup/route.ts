import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { resolveEndUser } from "@/lib/sdk-users";
import Stripe from "stripe";
import crypto from "crypto";

function hashKey(key: string): string {
  return crypto.createHash("sha256").update(key).digest("hex");
}

async function authenticateApiKey(req: NextRequest) {
  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer mk_")) return null;
  const apiKey = auth.slice(7);
  const keyHash = hashKey(apiKey);
  const supabase = getSupabaseServer();
  const { data } = await supabase
    .from("api_keys")
    .select("id, user_id, active")
    .eq("key_hash", keyHash)
    .single();
  if (!data || !data.active) return null;
  return data;
}

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
  const supabase = getSupabaseServer();
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
    apiVersion: "2025-04-30.basil",
  });

  // Get or create Stripe customer for this end-user
  const { data: endUser } = await supabase
    .from("sdk_end_users")
    .select("stripe_customer_id")
    .eq("id", internalId)
    .single();

  let customerId = endUser?.stripe_customer_id;

  if (!customerId) {
    const customer = await stripe.customers.create({
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
    payment_method_types: ["card"],
  });

  return NextResponse.json({
    clientSecret: setupIntent.client_secret,
    customerId,
  });
}
