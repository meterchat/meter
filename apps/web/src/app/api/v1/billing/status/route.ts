import { NextRequest, NextResponse } from "next/server";
import { resolveEndUser, getEndUserBillingStatus } from "@/lib/sdk-users";
import { authenticateApiKey } from "@/lib/api-auth";

// GET /api/v1/billing/status?endUserId=xxx — check if end-user has card on file
export async function GET(req: NextRequest) {
  const keyRecord = await authenticateApiKey(req);
  if (!keyRecord)
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const endUserId = req.nextUrl.searchParams.get("endUserId");
  if (!endUserId)
    return NextResponse.json(
      { error: "endUserId is required" },
      { status: 400 }
    );

  const internalId = await resolveEndUser(keyRecord.user_id, endUserId);
  const status = await getEndUserBillingStatus(internalId);

  return NextResponse.json(status);
}
