import { NextRequest, NextResponse } from "next/server";
import { requireAuth } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/oauth";
import { listRepos } from "@/lib/connectors/github";

// GET /api/github/repos?workspaceId=xxx — list user's GitHub repos for the repo selector
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const workspaceId = req.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) {
    return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  }

  try {
    const token = await getValidAccessToken(userId, "github", workspaceId);
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected" }, { status: 400 });
    }

    const result = await listRepos(token.accessToken, 50);
    return NextResponse.json(result);
  } catch (err) {
    console.error("Failed to list repos:", err);
    return NextResponse.json({ error: "Failed to list repos" }, { status: 500 });
  }
}
