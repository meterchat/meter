import { NextResponse, NextRequest } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

function generateId() {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

async function verifySignature(
  payload: string,
  signature: string | null,
  secret: string
): Promise<boolean> {
  if (!signature) return false;
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));
  const expected =
    "sha256=" +
    Array.from(new Uint8Array(sig))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
  return signature === expected;
}

// POST /api/log/webhook — GitHub webhook receiver for push events
export async function POST(request: NextRequest) {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "Webhook not configured" },
      { status: 500 }
    );
  }

  try {
    const rawBody = await request.text();
    const signature = request.headers.get("x-hub-signature-256");

    const valid = await verifySignature(rawBody, signature, secret);
    if (!valid) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const event = request.headers.get("x-github-event");

    // GitHub sends a "ping" event when the webhook is first created — acknowledge it
    if (event === "ping") {
      return NextResponse.json({ ok: true, event: "ping" });
    }

    if (event !== "push") {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const payload = JSON.parse(rawBody);
    const commits = payload.commits ?? [];
    const repo = payload.repository?.full_name ?? "";

    if (commits.length === 0) {
      return NextResponse.json({ ok: true, skipped: true });
    }

    const supabase = getSupabaseServer();
    const entries = commits.map(
      (c: { id: string; url: string; message: string; author?: { username?: string } }) => ({
        id: generateId() + c.id.slice(0, 6),
        type: "commit_pushed" as const,
        actor: "meter",
        commit_sha: c.id.slice(0, 7),
        commit_url: c.url,
        commit_repo: repo,
      })
    );

    const { error } = await supabase.from("log_entries").insert(entries);
    if (error) throw error;

    return NextResponse.json({ ok: true, count: entries.length });
  } catch (err) {
    console.error("Webhook error:", err);
    return NextResponse.json(
      { error: "Webhook processing failed" },
      { status: 500 }
    );
  }
}
