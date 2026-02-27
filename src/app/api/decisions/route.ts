import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

// GET /api/decisions — load all non-archived decisions for the authenticated user
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();

    const { data, error } = await supabase
      .from("decisions")
      .select("*")
      .eq("user_id", userId)
      .eq("archived", false)
      .order("created_at", { ascending: false });

    if (error) throw error;

    // Map DB columns to client-side Decision shape
    const decisions = (data ?? []).map((d) => ({
      id: d.id,
      title: d.title,
      status: d.status ?? "undecided",
      archived: d.archived ?? false,
      choice: d.choice ?? undefined,
      alternatives: d.alternatives ?? undefined,
      reasoning: d.reasoning ?? undefined,
      projectId: d.project_id ?? undefined,
      chatMessageId: d.chat_message_id ?? undefined,
      createdAt: new Date(d.created_at).getTime(),
      updatedAt: new Date(d.updated_at).getTime(),
    }));

    return NextResponse.json({ decisions });
  } catch (err) {
    console.error("Failed to load decisions:", err);
    return NextResponse.json({ error: "Failed to load decisions" }, { status: 500 });
  }
}
