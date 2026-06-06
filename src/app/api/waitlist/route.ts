import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireSuperAdmin } from "@/lib/auth";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// POST /api/waitlist — join the waitlist / request an invite (no auth required)
export async function POST(req: NextRequest) {
  try {
    const { email, source } = await req.json();
    if (!email || typeof email !== "string") {
      return NextResponse.json({ error: "Email required" }, { status: 400 });
    }

    const normalizedEmail = email.toLowerCase().trim();
    if (!EMAIL_RE.test(normalizedEmail)) {
      return NextResponse.json({ error: "Enter a valid email" }, { status: 400 });
    }

    const supabase = getSupabaseServer();

    // Idempotent: if the email is already on the list, treat as success.
    const { data: existing } = await supabase
      .from("waitlist_signups")
      .select("id")
      .eq("email", normalizedEmail)
      .maybeSingle();

    if (existing) {
      return NextResponse.json({ ok: true, alreadyJoined: true });
    }

    const { error } = await supabase.from("waitlist_signups").insert({
      id: generateId(),
      email: normalizedEmail,
      source: typeof source === "string" ? source.slice(0, 60) : "homepage",
    });

    if (error) {
      // Unique-index race: another request inserted the same email first.
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, alreadyJoined: true });
      }
      throw error;
    }

    return NextResponse.json({ ok: true });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("Waitlist signup error:", message);
    return NextResponse.json({ error: "Failed to join waitlist" }, { status: 500 });
  }
}

// GET /api/waitlist — superadmin-only list of signups
export async function GET(req: NextRequest) {
  const auth = await requireSuperAdmin();
  if (auth instanceof NextResponse) return auth;

  try {
    const supabase = getSupabaseServer();
    const { searchParams } = new URL(req.url);
    const limit = Math.min(parseInt(searchParams.get("limit") || "200"), 1000);

    const { data, error } = await supabase
      .from("waitlist_signups")
      .select("id, email, source, created_at")
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) throw error;

    return NextResponse.json(
      { signups: data ?? [], count: data?.length ?? 0 },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (err) {
    console.error("Failed to fetch waitlist signups:", err);
    return NextResponse.json({ error: "Failed to fetch waitlist" }, { status: 500 });
  }
}
