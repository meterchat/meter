import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import { getValidAccessToken } from "@/lib/oauth";
import { getFileContent, createOrUpdateFile, createBranch } from "@/lib/connectors/github";
import { serverTrackArtifactsPushed } from "@/lib/analytics-server";
import { serverEmitLogEvent } from "@/lib/log-event-server";

// POST /api/artifacts/push — push artifacts to GitHub
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { artifactIds, repo, path: basePath, workspaceId, branch } = await req.json();

    if (!repo || typeof repo !== "string" || !repo.includes("/")) {
      return NextResponse.json({ error: "repo must be in owner/name format" }, { status: 400 });
    }

    if (!workspaceId) {
      return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    }

    const token = await getValidAccessToken(userId, "github", workspaceId);
    if (!token) {
      return NextResponse.json({ error: "GitHub not connected. Please connect GitHub first." }, { status: 400 });
    }

    const [owner, repoName] = repo.split("/");
    const supabase = getSupabaseServer();

    // Load artifacts to push — scoped to workspace
    let query = supabase
      .from("artifacts")
      .select("*")
      .eq("user_id", userId)
      .or(`session_id.eq.${workspaceId},project_id.eq.${workspaceId}`);

    if (artifactIds && Array.isArray(artifactIds) && artifactIds.length > 0) {
      query = query.in("id", artifactIds);
    }

    const { data: artifacts, error } = await query;
    if (error) throw error;
    if (!artifacts || artifacts.length === 0) {
      return NextResponse.json({ error: "No artifacts found to push" }, { status: 404 });
    }

    // Create a new branch if specified (never push to main directly)
    const targetBranch = branch || `meter/${Date.now().toString(36)}`;
    try {
      await createBranch(token.accessToken, owner, repoName, targetBranch);
    } catch (err) {
      console.error("[artifacts/push] Failed to create branch:", err);
      return NextResponse.json({ error: `Failed to create branch: ${err instanceof Error ? err.message : String(err)}` }, { status: 500 });
    }

    const results: { filePath: string; sha: string; url: string }[] = [];
    const errors: { filePath: string; error: string }[] = [];

    for (const artifact of artifacts) {
      const filePath = basePath
        ? `${basePath.replace(/\/$/, "")}/${artifact.file_path}`
        : artifact.file_path;

      try {
        // Check if file exists on the branch to get SHA for update
        const existing = await getFileContent(token.accessToken, owner, repoName, filePath, targetBranch);
        const result = await createOrUpdateFile(
          token.accessToken,
          owner,
          repoName,
          filePath,
          artifact.content,
          `Update ${artifact.file_path} via Meter`,
          targetBranch,
          existing?.sha,
        );

        // Update artifact record
        const { error: updateErr } = await supabase.from("artifacts").update({
          status: "synced",
          github_repo: repo,
          github_sha: result.sha,
          last_pushed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq("id", artifact.id);
        if (updateErr) throw updateErr;

        results.push({ filePath: artifact.file_path, sha: result.sha, url: result.url });
      } catch (err) {
        errors.push({
          filePath: artifact.file_path,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }

    serverTrackArtifactsPushed(userId, {
      repo,
      artifactCount: artifacts.length,
      succeeded: results.length,
      failed: errors.length,
      workspaceId,
    });
    serverEmitLogEvent("artifacts_pushed", userId, {
      preview: `${results.length}/${artifacts.length} files pushed to ${repo}`,
    });

    return NextResponse.json({
      pushed: results,
      errors: errors.length > 0 ? errors : undefined,
      total: artifacts.length,
      succeeded: results.length,
    });
  } catch (err) {
    console.error("Failed to push artifacts:", err);
    return NextResponse.json({ error: "Failed to push artifacts" }, { status: 500 });
  }
}
