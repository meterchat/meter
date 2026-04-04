// src/app/api/cron/reap-stale-runs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// Vercel cron calls this every minute. Marks stale streaming runs as timed_out.
// The 5-minute threshold matches maxDuration=300 in the chat route.
export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls.
  // Reject if secret is missing OR if the header doesn't match.
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const supabase = getSupabaseServer();

    // Mark stale runs as timed_out.
    // IMPORTANT: Do NOT touch chat_messages.receipt_status here.
    // Runs answer "is generation alive?" Messages answer "is content final?"
    // A timed-out run means generation stopped, but the partial content is
    // NOT "metered" — force-marking it as such is the same lie as fake-$0.
    // The client checks run status (not receipt_status) for streaming UI.
    const { data: reaped, error: reapErr } = await supabase
      .from("chat_runs")
      .update({
        status: "timed_out",
        finalized_at: new Date().toISOString(),
      })
      .eq("status", "streaming")
      .lt("last_chunk_at", new Date(Date.now() - 5 * 60 * 1000).toISOString())
      .is("finalized_at", null)
      .select("id");

    if (reapErr) {
      console.error("[reap-stale-runs] Failed to reap:", reapErr);
      return NextResponse.json({ error: "Failed to reap" }, { status: 500 });
    }

    if (reaped && reaped.length > 0) {
      console.log(`[reap-stale-runs] Reaped ${reaped.length} stale runs`);
    }

    return NextResponse.json({ ok: true, reaped: reaped?.length ?? 0 });
  } catch (err) {
    console.error("[reap-stale-runs] Error:", err);
    return NextResponse.json({ error: "Internal error" }, { status: 500 });
  }
}
