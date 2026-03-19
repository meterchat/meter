import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { resolveEndUser } from "@/lib/sdk-users";
import { authenticateApiKey } from "@/lib/api-auth";
import { getWhop, WHOP_COMPANY_ID } from "@/lib/whop";

// POST /api/v1/billing/setup — create Whop setup checkout for end-user card
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

  const whop = getWhop();
  const config = await whop.checkoutConfigurations.create({
    company_id: WHOP_COMPANY_ID,
    mode: "setup",
    redirect_url: `${process.env.NEXT_PUBLIC_APP_URL}/api/billing/confirm-redirect`,
    metadata: {
      meter_sdk_user_id: internalId,
      developer_id: keyRecord.user_id,
      external_user_id: endUserId,
    },
  });

  return NextResponse.json({
    sessionId: config.id,
    purchaseUrl: config.purchase_url,
  });
}
