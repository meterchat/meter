import { NextRequest, NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/oauth";
import { requireAuth } from "@/lib/auth";

export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");

  if (!workspaceId) {
    return NextResponse.json({ error: "Missing workspaceId" }, { status: 400 });
  }

  const status = await getConnectionStatus(userId, workspaceId);
  return NextResponse.json(status);
}
