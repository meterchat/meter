// src/app/api/workspaces/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

// PATCH /api/workspaces/:id — rename, archive, or update a workspace
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const supabase = getSupabaseServer();
    const dbId = scopedId(userId, id);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name != null) {
      updates.workspace_name = body.name;
      updates.project_name = body.name;
    }
    if (body.archived != null) updates.archived = body.archived;
    if (body.committed != null) updates.committed = body.committed;

    const { data, error } = await supabase
      .from("chat_sessions")
      .update(updates)
      .eq("id", dbId)
      .eq("user_id", userId)
      .select("id");

    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update workspace:", err);
    return NextResponse.json({ error: "Failed to update workspace" }, { status: 500 });
  }
}

// DELETE /api/workspaces/:id — soft-delete a workspace
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;
  const { id } = await params;

  try {
    const supabase = getSupabaseServer();
    const dbId = scopedId(userId, id);

    const { data, error } = await supabase
      .from("chat_sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", dbId)
      .eq("user_id", userId)
      .select("id");

    if (error) throw error;
    if (!data?.length) {
      return NextResponse.json({ error: "Workspace not found" }, { status: 404 });
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete workspace:", err);
    return NextResponse.json({ error: "Failed to delete workspace" }, { status: 500 });
  }
}
