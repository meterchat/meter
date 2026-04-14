import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

export const dynamic = "force-dynamic";

/** GET /api/datasheets?sessionId=xxx */
export async function GET(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const sessionId = req.nextUrl.searchParams.get("sessionId");
  if (!sessionId) return NextResponse.json({ error: "Missing sessionId" }, { status: 400 });

  const dbSessionId = sessionId.startsWith(`${userId}:`) ? sessionId : `${userId}:${sessionId}`;
  const supabase = getSupabaseServer();

  const { data, error } = await supabase
    .from("datasheets")
    .select("*")
    .eq("user_id", userId)
    .or(`session_id.eq.${dbSessionId},session_id.eq.${sessionId}`)
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[datasheets] GET error:", error.message);
    return NextResponse.json({ error: "Failed to fetch datasheets" }, { status: 500 });
  }

  const datasheets = (data ?? []).map((r: Record<string, unknown>) => ({
    id: r.id,
    title: r.title,
    columns: r.columns,
    rows: r.rows,
    sessionId,
    chatMessageId: r.chat_message_id,
    createdAt: new Date(r.created_at as string).getTime(),
    updatedAt: new Date(r.updated_at as string).getTime(),
  }));

  return NextResponse.json({ datasheets });
}

/** PATCH /api/datasheets — update rows/columns */
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const { id, title, columns, rows } = await req.json();
    if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

    const supabase = getSupabaseServer();
    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (title !== undefined) update.title = title;
    if (columns !== undefined) update.columns = columns;
    if (rows !== undefined) update.rows = rows;

    const { error } = await supabase
      .from("datasheets")
      .update(update)
      .eq("id", id)
      .eq("user_id", userId);

    if (error) {
      console.error("[datasheets] PATCH error:", error.message);
      return NextResponse.json({ error: "Failed to update" }, { status: 500 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    console.error("[datasheets] PATCH error:", err);
    return NextResponse.json({ error: "Failed to update" }, { status: 500 });
  }
}

/** DELETE /api/datasheets?id=xxx */
export async function DELETE(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const id = req.nextUrl.searchParams.get("id");
  if (!id) return NextResponse.json({ error: "Missing id" }, { status: 400 });

  const supabase = getSupabaseServer();
  const { error } = await supabase.from("datasheets").delete().eq("id", id).eq("user_id", userId);

  if (error) {
    console.error("[datasheets] DELETE error:", error.message);
    return NextResponse.json({ error: "Failed to delete" }, { status: 500 });
  }

  return NextResponse.json({ success: true });
}
