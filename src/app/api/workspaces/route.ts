// src/app/api/workspaces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import crypto from "crypto";

function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

function unscopedId(userId: string, dbId: string): string {
  const prefix = `${userId}:`;
  return dbId.startsWith(prefix) ? dbId.slice(prefix.length) : dbId;
}

// POST /api/workspaces — create or get a workspace (server-minted ID)
//
// Supports get-or-create semantics: if `idempotencyKey` is provided (e.g.
// "default" for the initial workspace), the server returns the existing
// workspace for that user+key instead of creating a duplicate. This ensures
// two devices logging in for the first time converge on the same workspace.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    const name = (body.name as string)?.trim();
    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const idempotencyKey = (body.idempotencyKey as string) ?? null;

    // Get-or-create: if idempotencyKey is provided, check for existing workspace
    if (idempotencyKey) {
      const tag = `${userId}:idem:${idempotencyKey}`;
      const { data: existing } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("idempotency_key", tag)
        .is("deleted_at", null)
        .single();

      if (existing) {
        return NextResponse.json({
          sessionId: unscopedId(userId, existing.id),
          name,
          created: false,
        });
      }
    }

    const localId = crypto.randomBytes(8).toString("hex");
    const dbId = scopedId(userId, localId);

    // Support subtrack creation
    const isSubtrack = body.isSubtrack === true;
    const parentSessionId = body.parentSessionId as string | undefined;
    const forkMessageId = body.forkMessageId as string | undefined;

    const insertData: Record<string, unknown> = {
      id: dbId,
      user_id: userId,
      project_name: name,
      workspace_name: name,
      total_cost: 0,
      today_cost: 0,
      today_tokens_in: 0,
      today_tokens_out: 0,
      today_message_count: 0,
      today_date: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    };

    if (idempotencyKey) {
      insertData.idempotency_key = `${userId}:idem:${idempotencyKey}`;
    }
    if (isSubtrack) {
      insertData.is_subtrack = true;
      if (parentSessionId) insertData.parent_session_id = scopedId(userId, parentSessionId);
      if (forkMessageId) insertData.fork_message_id = forkMessageId;
    }

    const { error } = await supabase.from("chat_sessions").insert(insertData);

    // Handle race: if two devices hit get-or-create simultaneously with the
    // same idempotencyKey, the loser gets a unique constraint violation (23505)
    // on the idempotency_key index. Re-read the winner's row instead of throwing.
    if (error?.code === "23505" && idempotencyKey) {
      const { data: winner } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("idempotency_key", `${userId}:idem:${idempotencyKey}`)
        .single();
      if (winner) {
        return NextResponse.json({
          sessionId: unscopedId(userId, winner.id),
          name,
          created: false,
        });
      }
    }
    if (error) throw error;

    // Side effects (same as the old POST /api/sessions creation path):
    // 1. Analytics
    const { serverTrackSessionCreated } = await import("@/lib/analytics-server");
    serverTrackSessionCreated(userId, { sessionId: localId, projectName: name });

    // 2. Portal slug for non-subtracks
    if (!isSubtrack) {
      try {
        const { generatePortalSlug } = await import("@/lib/portal-slug");
        const slug = generatePortalSlug(name || "workspace");
        await supabase
          .from("chat_sessions")
          .update({ portal_slug: slug })
          .eq("id", dbId);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ sessionId: localId, name, created: true });
  } catch (err) {
    console.error("Failed to create workspace:", err);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}
