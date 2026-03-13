import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { settleWorkspace } from "@/lib/settle-workspace";

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const { workspaceId, amount, messageIds, chargeIds } = await req.json();

  if (!workspaceId || !amount || amount <= 0) {
    return NextResponse.json({ error: "workspaceId and positive amount required" }, { status: 400 });
  }

  const result = await settleWorkspace({
    userId,
    workspaceId,
    amount,
    messageIds: messageIds ?? [],
    chargeIds: chargeIds ?? [],
  });

  if (!result.success) {
    const isPaymentError = result.error?.includes("authentication_required")
      || result.error?.includes("card_declined")
      || result.error?.includes("Payment not succeeded");
    const isForbidden = result.error?.includes("Forbidden");
    const status = isForbidden ? 403 : isPaymentError ? 402 : 400;
    return NextResponse.json({ error: result.error }, { status });
  }

  return NextResponse.json({
    success: true,
    paymentIntentId: result.paymentIntentId,
    amountCharged: result.amountCharged,
    creditUsed: result.creditUsed,
    freeCredit: result.paymentIntentId === null,
  });
}
