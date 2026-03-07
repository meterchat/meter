import { NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

const METER_EMAIL = "a@buxor.co";

// GET /api/log/decisions — public locked decisions for the Meter workspace
export async function GET() {
  try {
    const supabase = getSupabaseServer();

    // Look up the Meter founder user by email
    const { data: user, error: userError } = await supabase
      .from("meter_users")
      .select("id")
      .eq("email", METER_EMAIL)
      .single();

    if (userError || !user) {
      return NextResponse.json({ decisions: [] });
    }

    // Fetch all decided (locked) decisions for this user
    const { data, error } = await supabase
      .from("decisions")
      .select("id, title, status, choice, reasoning, category, version, revisit_count, created_at, updated_at")
      .eq("user_id", user.id)
      .eq("status", "decided")
      .eq("archived", false)
      .order("updated_at", { ascending: false });

    if (error) throw error;

    const decisions = (data ?? []).map((d: Record<string, unknown>) => ({
      id: d.id,
      title: d.title,
      status: d.status,
      choice: d.choice,
      reasoning: d.reasoning,
      category: d.category,
      version: (d.version as number) ?? 1,
      revisitCount: (d.revisit_count as number) ?? 0,
      createdAt: new Date(d.created_at as string).getTime(),
      updatedAt: new Date(d.updated_at as string).getTime(),
    }));

    return NextResponse.json(
      { decisions },
      {
        headers: {
          "Cache-Control": "public, s-maxage=30, stale-while-revalidate=60",
        },
      }
    );
  } catch (err) {
    console.error("Failed to fetch log decisions:", err);
    return NextResponse.json(
      { error: "Failed to fetch decisions" },
      { status: 500 }
    );
  }
}
