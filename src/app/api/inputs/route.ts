import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/inputs?sessionId=xxx — list workspace inputs */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) {
    return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });
  }

  const dbSessionId = sessionId.startsWith(`${userId}:`) ? sessionId : `${userId}:${sessionId}`;
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("workspace_inputs")
    .select("*")
    .eq("user_id", userId)
    .eq("session_id", dbSessionId)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[inputs] GET error:", error.message);
    return NextResponse.json({ error: "Failed to fetch inputs" }, { status: 500 });
  }

  const inputs = (data ?? []).map((row: Record<string, unknown>) => ({
    id: row.id,
    fileName: row.file_name,
    filePath: row.file_path,
    publicUrl: row.public_url,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    contentText: row.content_text,
    enabled: row.enabled ?? true,
    sessionId,
    createdAt: new Date(row.created_at as string).getTime(),
  }));

  return NextResponse.json({ inputs });
}

/** DELETE /api/inputs?id=xxx — remove a workspace input */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const inputId = req.nextUrl.searchParams.get("id");
  if (!inputId) {
    return NextResponse.json({ error: "Missing id" }, { status: 400 });
  }

  const supabase = getSupabaseServer();

  // Fetch the input to get file_path for storage cleanup
  const { data: input } = await supabase
    .from("workspace_inputs")
    .select("file_path")
    .eq("id", inputId)
    .eq("user_id", userId)
    .single();

  if (!input) {
    return NextResponse.json({ error: "Input not found" }, { status: 404 });
  }

  // Delete from storage
  await supabase.storage.from("attachments").remove([input.file_path]);

  // Delete from DB
  const { error } = await supabase
    .from("workspace_inputs")
    .delete()
    .eq("id", inputId)
    .eq("user_id", userId);

  if (error) {
    console.error("[inputs] DELETE error:", error.message);
    return NextResponse.json({ error: "Failed to delete input" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}

/** PATCH /api/inputs — toggle enabled state */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { id, enabled } = await req.json();
    if (!id || typeof enabled !== "boolean") {
      return NextResponse.json({ error: "Missing id or enabled" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const { error } = await supabase
      .from("workspace_inputs")
      .update({ enabled })
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[inputs] PATCH error:", error.message);
      return NextResponse.json({ error: "Failed to update input" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[inputs] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update input" }, { status: 500 });
  }
}
