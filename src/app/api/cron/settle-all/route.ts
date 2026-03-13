import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { settleWorkspace } from "@/lib/settle-workspace";

const CRON_SECRET = process.env.CRON_SECRET;
const AUTO_SETTLE_THRESHOLD = 10; // $10

/**
 * POST /api/cron/settle-all
 *
 * Server-side cron job that settles ALL workspaces across ALL users
 * when their pending balance meets the auto-settle threshold ($10).
 *
 * Runs daily at midnight UTC via Vercel Cron.
 * Auth: Bearer token via CRON_SECRET env var.
 */
export async function POST(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  if (!CRON_SECRET || authHeader !== `Bearer ${CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = getSupabaseServer();

  // Find all sessions with unsettled balance >= threshold.
  // We query unsettled assistant messages grouped by session,
  // excluding deleted sessions and sessions with prior settlement failure.
  const { data: workspaces, error: queryError } = await supabase.rpc(
    "get_unsettled_workspaces",
    { threshold: AUTO_SETTLE_THRESHOLD }
  ).catch(() => ({ data: null, error: { message: "RPC not found, falling back to manual query" } }));

  // Fallback: manual query if RPC doesn't exist
  let settleTargets: Array<{
    session_id: string;
    user_id: string;
    pending_amount: number;
    message_ids: string[];
  }>;

  if (queryError || !workspaces) {
    // Manual query: get all unsettled messages grouped by session
    const { data: sessions, error: sessErr } = await supabase
      .from("chat_sessions")
      .select("id, user_id")
      .is("deleted_at", null)
      .eq("settlement_failed", false);

    if (sessErr || !sessions?.length) {
      return NextResponse.json({
        processed: 0, settled: 0, failed: 0, skipped: 0,
        error: sessErr?.message,
      });
    }

    // Filter out superadmin users
    const userIds = [...new Set(sessions.map((s) => s.user_id))];
    const { data: users } = await supabase
      .from("meter_users")
      .select("id, account_type")
      .in("id", userIds);
    const superadminIds = new Set(
      (users ?? []).filter((u) => u.account_type === "superadmin").map((u) => u.id)
    );
    const eligibleSessions = sessions.filter((s) => !superadminIds.has(s.user_id));

    if (eligibleSessions.length === 0) {
      return NextResponse.json({ processed: 0, settled: 0, failed: 0, skipped: 0 });
    }

    // For each session, get unsettled messages and sum cost
    settleTargets = [];
    // Process in batches to avoid overwhelming Supabase
    const BATCH_SIZE = 50;
    for (let i = 0; i < eligibleSessions.length; i += BATCH_SIZE) {
      const batch = eligibleSessions.slice(i, i + BATCH_SIZE);
      const sessionIds = batch.map((s) => s.id);
      const { data: messages } = await supabase
        .from("chat_messages")
        .select("id, session_id, cost")
        .in("session_id", sessionIds)
        .eq("role", "assistant")
        .eq("settled", false)
        .not("cost", "is", null);

      if (!messages?.length) continue;

      // Group by session
      const bySession = new Map<string, { cost: number; ids: string[] }>();
      for (const msg of messages) {
        const entry = bySession.get(msg.session_id) ?? { cost: 0, ids: [] };
        entry.cost += Number(msg.cost ?? 0);
        entry.ids.push(msg.id);
        bySession.set(msg.session_id, entry);
      }

      for (const [sessionId, { cost, ids }] of bySession) {
        if (cost >= AUTO_SETTLE_THRESHOLD) {
          const session = batch.find((s) => s.id === sessionId);
          if (session) {
            settleTargets.push({
              session_id: sessionId,
              user_id: session.user_id,
              pending_amount: Math.round(cost * 100) / 100,
              message_ids: ids,
            });
          }
        }
      }
    }
  } else {
    settleTargets = workspaces;
  }

  // Process each workspace settlement
  let settled = 0;
  let failed = 0;
  let skipped = 0;
  const errors: Array<{ sessionId: string; error: string }> = [];

  for (const target of settleTargets) {
    try {
      const result = await settleWorkspace({
        userId: target.user_id,
        workspaceId: target.session_id,
        amount: target.pending_amount,
        messageIds: target.message_ids,
        skipOwnershipCheck: true, // we already queried these messages
      });

      if (result.success) {
        settled++;
      } else {
        failed++;
        errors.push({ sessionId: target.session_id, error: result.error ?? "Unknown error" });
      }
    } catch (err) {
      failed++;
      errors.push({
        sessionId: target.session_id,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  console.log(`[cron/settle-all] processed=${settleTargets.length} settled=${settled} failed=${failed} skipped=${skipped}`);

  return NextResponse.json({
    processed: settleTargets.length,
    settled,
    failed,
    skipped,
    ...(errors.length > 0 ? { errors } : {}),
  });
}
