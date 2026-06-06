import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireSuperAdmin } from "@/lib/auth";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// Fire a notification email on each new signup via Resend.
// No-op if RESEND_API_KEY isn't configured, so it never breaks signups.
async function notifyNewSignup(email: string, source: string) {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return;
  const to = process.env.WAITLIST_NOTIFY_TO || "s@meter.chat";
  const from = process.env.WAITLIST_NOTIFY_FROM || "Meter Waitlist <onboarding@resend.dev>";
  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        from,
        to,
        reply_to: email,
        subject: `New waitlist signup: ${email}`,
        text: `${email} just requested an invite to Meter.\n\nSource: ${source}\nTime: ${new Date().toISOString()}`,
      }),
    });
    if (!res.ok) {
      console.error("Waitlist notify failed:", res.status, await res.text().catch(() => ""));
    }
  } catch (err) {
    console.error("Waitlist notify error:", err);
  }
}

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

    const src = typeof source === "string" ? source.slice(0, 60) : "homepage";
    const { error } = await supabase.from("waitlist_signups").insert({
      id: generateId(),
      email: normalizedEmail,
      source: src,
    });

    if (error) {
      // Unique-index race: another request inserted the same email first.
      if (error.code === "23505") {
        return NextResponse.json({ ok: true, alreadyJoined: true });
      }
      throw error;
    }

    // New signup — notify (awaited so it completes in serverless, but its
    // own try/catch ensures a mail failure never fails the signup).
    await notifyNewSignup(normalizedEmail, src);

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
