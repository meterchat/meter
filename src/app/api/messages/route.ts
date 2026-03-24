import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// Allowed fields that can be patched on a message
const PATCHABLE_FIELDS = new Set([
  "pinned",
  "hidden",
  "decision_id",
  "clarifying_questions",
]);

// PATCH /api/messages — update specific fields on an existing message
// Body: { messageId: string, fields: { pinned?: boolean, hidden?: boolean, ... } }
export async function PATCH(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    const { messageId, fields } = body as {
      messageId: string;
      fields: Record<string, unknown>;
    };

    if (!messageId || !fields || typeof fields !== "object") {
      return NextResponse.json(
        { error: "Missing messageId or fields" },
        { status: 400 },
      );
    }

    // Filter to only allowed fields
    const update: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(fields)) {
      if (PATCHABLE_FIELDS.has(key)) {
        update[key] = value;
      }
    }

    if (Object.keys(update).length === 0) {
      return NextResponse.json(
        { error: "No patchable fields provided" },
        { status: 400 },
      );
    }

    const supabase = getSupabaseServer();

    // Verify the message belongs to a session owned by this user
    const { data: msg, error: lookupErr } = await supabase
      .from("chat_messages")
      .select("id, session_id")
      .eq("id", messageId)
      .single();

    if (lookupErr || !msg) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 },
      );
    }

    const { data: session, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("user_id")
      .eq("id", msg.session_id)
      .single();

    if (sessErr || !session || session.user_id !== userId) {
      return NextResponse.json(
        { error: "Message not found" },
        { status: 404 },
      );
    }

    // Apply the update
    const { error: updateErr } = await supabase
      .from("chat_messages")
      .update(update)
      .eq("id", messageId);

    if (updateErr) throw updateErr;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[messages] PATCH error:", err);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
