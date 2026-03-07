import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

/**
 * GET /api/recover-sessions — Dry-run audit of all sessions.
 * Shows what the recovery would do without making changes.
 *
 * POST /api/recover-sessions — Execute recovery.
 * Consolidates messages back into the correct main workspace sessions.
 *
 * The problem: When tracks (forked conversation paths) were created, they
 * cloned messages from the main session with identical IDs. Server-side
 * upsert (onConflict: "id") reassigned those shared messages' session_id
 * to whichever track synced last, effectively stealing them from main.
 * Additionally, upsertWorkspacesFromSessions treated track sessions as
 * new workspaces, creating phantom workspace entries.
 *
 * Recovery strategy:
 * 1. Group sessions by workspace name (case-insensitive)
 * 2. For each group, identify the canonical "main" session
 *    (oldest non-subtrack, or the one explicitly not a subtrack)
 * 3. Find messages in sibling sessions that have timestamps <= the main
 *    session's last message (these were likely stolen by the upsert bug)
 * 4. Reassign stolen messages back to the main session
 * 5. Mark phantom workspace sessions as subtracks
 */

function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

function unscopedId(userId: string, dbId: string): string {
  const prefix = `${userId}:`;
  return dbId.startsWith(prefix) ? dbId.slice(prefix.length) : dbId;
}

interface SessionSummary {
  id: string;
  scopedId: string;
  name: string;
  isSubtrack: boolean;
  parentSessionId: string | null;
  messageCount: number;
  userMessageCount: number;
  firstMessageAt: number | null;
  lastMessageAt: number | null;
  createdAt: string;
  deletedAt: string | null;
  totalCost: number;
  sampleMessages: Array<{ id: string; role: string; timestamp: number; preview: string }>;
}

interface WorkspaceGroup {
  name: string;
  mainSession: SessionSummary | null;
  otherSessions: SessionSummary[];
  totalMessages: number;
  duplicateMessageIds: string[]; // messages that exist in multiple sessions
}

async function buildSessionSummaries(supabase: ReturnType<typeof getSupabaseServer>, userId: string): Promise<SessionSummary[]> {
  const { data: sessions, error } = await supabase
    .from("chat_sessions")
    .select("*")
    .eq("user_id", userId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const prefix = `${userId}:`;
  const unscope = (id: string) => id.startsWith(prefix) ? id.slice(prefix.length) : id;

  const summaries: SessionSummary[] = [];

  for (const s of sessions ?? []) {
    const { count: msgCount } = await supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("session_id", s.id);

    const { count: userMsgCount } = await supabase
      .from("chat_messages")
      .select("id", { count: "exact", head: true })
      .eq("session_id", s.id)
      .eq("role", "user");

    const { data: firstMsg } = await supabase
      .from("chat_messages")
      .select("timestamp")
      .eq("session_id", s.id)
      .order("timestamp", { ascending: true })
      .limit(1);

    const { data: lastMsg } = await supabase
      .from("chat_messages")
      .select("timestamp")
      .eq("session_id", s.id)
      .order("timestamp", { ascending: false })
      .limit(1);

    // Get first 5 user messages to help identify
    const { data: samples } = await supabase
      .from("chat_messages")
      .select("id, role, content, timestamp")
      .eq("session_id", s.id)
      .eq("role", "user")
      .order("timestamp", { ascending: true })
      .limit(5);

    summaries.push({
      id: unscope(s.id),
      scopedId: s.id,
      name: s.workspace_name || s.project_name || "unnamed",
      isSubtrack: s.is_subtrack ?? false,
      parentSessionId: s.parent_session_id ? unscope(s.parent_session_id) : null,
      messageCount: msgCount ?? 0,
      userMessageCount: userMsgCount ?? 0,
      firstMessageAt: firstMsg?.[0]?.timestamp ?? null,
      lastMessageAt: lastMsg?.[0]?.timestamp ?? null,
      createdAt: s.created_at,
      deletedAt: s.deleted_at,
      totalCost: s.total_cost ?? 0,
      sampleMessages: (samples ?? []).map((m) => ({
        id: m.id as string,
        role: m.role as string,
        timestamp: m.timestamp as number,
        preview: ((m.content as string) ?? "").slice(0, 150),
      })),
    });
  }

  return summaries;
}

function groupByWorkspace(summaries: SessionSummary[]): WorkspaceGroup[] {
  // Group by normalized name
  const groups = new Map<string, SessionSummary[]>();

  for (const s of summaries) {
    // Skip soft-deleted sessions
    if (s.deletedAt) continue;

    const key = s.name.toLowerCase().trim();
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(s);
  }

  const result: WorkspaceGroup[] = [];

  for (const [name, sessions] of groups) {
    // Identify the main session: prefer non-subtrack, then oldest, then most messages
    const nonSubtracks = sessions.filter((s) => !s.isSubtrack);
    const candidates = nonSubtracks.length > 0 ? nonSubtracks : sessions;

    // Sort by: oldest first, then most messages as tiebreaker
    candidates.sort((a, b) => {
      const dateA = new Date(a.createdAt).getTime();
      const dateB = new Date(b.createdAt).getTime();
      if (dateA !== dateB) return dateA - dateB;
      return b.messageCount - a.messageCount;
    });

    const mainSession = candidates[0] || null;
    const otherSessions = sessions.filter((s) => s !== mainSession);

    result.push({
      name,
      mainSession,
      otherSessions,
      totalMessages: sessions.reduce((sum, s) => sum + s.messageCount, 0),
      duplicateMessageIds: [], // populated during recovery
    });
  }

  return result;
}

export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const supabase = getSupabaseServer();
    const summaries = await buildSessionSummaries(supabase, userId);
    const groups = groupByWorkspace(summaries);

    // For each group with multiple sessions, find duplicate message IDs
    for (const group of groups) {
      if (!group.mainSession || group.otherSessions.length === 0) continue;

      // Get all message IDs from the main session
      const { data: mainMsgIds } = await supabase
        .from("chat_messages")
        .select("id")
        .eq("session_id", scopedId(userId, group.mainSession.id));

      const mainIds = new Set((mainMsgIds ?? []).map((m) => m.id as string));

      // Check each other session for overlapping message IDs
      for (const other of group.otherSessions) {
        const { data: otherMsgIds } = await supabase
          .from("chat_messages")
          .select("id")
          .eq("session_id", scopedId(userId, other.id));

        for (const m of otherMsgIds ?? []) {
          if (mainIds.has(m.id as string)) {
            group.duplicateMessageIds.push(m.id as string);
          }
        }
      }
    }

    // Build recovery plan
    const plan = groups
      .filter((g) => g.otherSessions.length > 0)
      .map((g) => ({
        workspace: g.name,
        mainSession: g.mainSession ? {
          id: g.mainSession.id,
          messageCount: g.mainSession.messageCount,
        } : null,
        sessionsToConsolidate: g.otherSessions.map((s) => ({
          id: s.id,
          messageCount: s.messageCount,
          isSubtrack: s.isSubtrack,
          action: s.messageCount === 0
            ? "delete (empty)"
            : `move ${s.messageCount} messages to main, then mark as subtrack`,
        })),
        duplicateMessageCount: g.duplicateMessageIds.length,
      }));

    return NextResponse.json({
      status: "dry_run",
      userId,
      totalSessions: summaries.length,
      activeSessions: summaries.filter((s) => !s.deletedAt).length,
      workspaceGroups: groups.map((g) => ({
        name: g.name,
        sessionCount: 1 + g.otherSessions.length,
        mainSession: g.mainSession ? {
          id: g.mainSession.id,
          messageCount: g.mainSession.messageCount,
          userMessages: g.mainSession.userMessageCount,
          firstMessageAt: g.mainSession.firstMessageAt,
          lastMessageAt: g.mainSession.lastMessageAt,
          isSubtrack: g.mainSession.isSubtrack,
          sampleMessages: g.mainSession.sampleMessages,
        } : null,
        otherSessions: g.otherSessions.map((s) => ({
          id: s.id,
          messageCount: s.messageCount,
          userMessages: s.userMessageCount,
          firstMessageAt: s.firstMessageAt,
          lastMessageAt: s.lastMessageAt,
          isSubtrack: s.isSubtrack,
          parentSessionId: s.parentSessionId,
          sampleMessages: s.sampleMessages,
        })),
        totalMessages: g.totalMessages,
        duplicateMessageCount: g.duplicateMessageIds.length,
      })),
      recoveryPlan: plan,
      instructions: "Review the plan above. To execute, POST to /api/recover-sessions with the body: { \"confirm\": true }. You can also specify { \"confirm\": true, \"workspace\": \"meter\" } to only recover a specific workspace.",
    });
  } catch (err) {
    console.error("Recovery audit error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

/**
 * POST /api/recover-sessions — Execute recovery with explicit mappings.
 *
 * Body format:
 * {
 *   "confirm": true,
 *   "mappings": [
 *     { "sourceSessionId": "cul6cds6", "targetSessionId": "meter" },
 *     { "sourceSessionId": "wl7hp31o", "targetSessionId": "meter" },
 *     { "sourceSessionId": "h2j6w3w1", "targetSessionId": "meter" },
 *     { "sourceSessionId": "mvqw4hq4", "targetSessionId": "robomart" },
 *     { "sourceSessionId": "ajx5a1cd", "targetSessionId": "ws_mm6onbug_fhi7vq" }
 *   ],
 *   "deleteEmpty": ["0ov13alt", "x8w7nh2t", "9b5gh6qn"]
 * }
 *
 * Each mapping moves ALL messages from sourceSessionId → targetSessionId.
 * Messages keep their original IDs and timestamps, so they interleave
 * correctly in chronological order.
 *
 * After moving, source sessions are marked is_subtrack=true but NOT deleted.
 * Use "deleteEmpty" to soft-delete specific empty/phantom sessions.
 *
 * POST with { "confirm": true, "cleanup": ["session1", "session2"] }
 * to soft-delete sessions after you've verified the migration worked.
 */
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    if (!body.confirm) {
      return NextResponse.json({
        error: 'Must pass { "confirm": true } to execute recovery',
      }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const log: string[] = [];
    let totalMessagesMoved = 0;
    let sessionsMarkedSubtrack = 0;
    let sessionsDeleted = 0;

    // --- Phase 1: Move messages via explicit mappings ---
    const mappings: Array<{ sourceSessionId: string; targetSessionId: string }> =
      body.mappings ?? [];

    for (const { sourceSessionId, targetSessionId } of mappings) {
      const sourceScopedId = scopedId(userId, sourceSessionId);
      const targetScopedId = scopedId(userId, targetSessionId);

      log.push(`\n--- Moving: ${sourceSessionId} → ${targetSessionId} ---`);

      // Verify source session exists
      const { data: sourceSession } = await supabase
        .from("chat_sessions")
        .select("id, workspace_name, project_name")
        .eq("id", sourceScopedId)
        .single();

      if (!sourceSession) {
        log.push(`  ✗ Source session "${sourceSessionId}" not found, skipping`);
        continue;
      }

      // Verify target session exists
      const { data: targetSession } = await supabase
        .from("chat_sessions")
        .select("id, workspace_name, project_name")
        .eq("id", targetScopedId)
        .single();

      if (!targetSession) {
        log.push(`  ✗ Target session "${targetSessionId}" not found, skipping`);
        continue;
      }

      // Count messages before move
      const { count: beforeCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", sourceScopedId);

      log.push(`  Source has ${beforeCount ?? 0} messages`);

      if (!beforeCount || beforeCount === 0) {
        log.push(`  → No messages to move, skipping`);
        continue;
      }

      // Move all messages in batches (paginate to handle >1000)
      let moved = 0;
      const PAGE = 500;

      while (true) {
        // Get batch of message IDs from source
        // offset stays at 0: moved messages are gone from source,
        // so the next query at range(0, PAGE-1) gets the next batch
        const { data: batch } = await supabase
          .from("chat_messages")
          .select("id")
          .eq("session_id", sourceScopedId)
          .order("timestamp", { ascending: true })
          .range(0, PAGE - 1);

        if (!batch || batch.length === 0) break;

        const ids = batch.map((m) => m.id as string);

        const { error: moveErr } = await supabase
          .from("chat_messages")
          .update({ session_id: targetScopedId })
          .in("id", ids);

        if (moveErr) {
          log.push(`  ✗ Error moving batch (already moved ${moved}): ${moveErr.message}`);
          // Failed batch remains in source — stop here
          break;
        }

        moved += ids.length;
      }

      totalMessagesMoved += moved;
      log.push(`  → Moved ${moved}/${beforeCount} messages`);

      // Only mark source as subtrack if ALL messages were successfully moved
      if (moved < beforeCount) {
        log.push(`  ⚠ Partial migration (${moved}/${beforeCount}) — skipping subtrack marking`);
      } else {
        // Mark source as subtrack of target (prevents phantom workspace recreation)
        await supabase
          .from("chat_sessions")
          .update({
            is_subtrack: true,
            parent_session_id: targetScopedId,
          })
          .eq("id", sourceScopedId);

        sessionsMarkedSubtrack++;
        log.push(`  → Marked source as subtrack of target`);
      }

      // Verify target message count after move
      const { count: targetAfter } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", targetScopedId);

      log.push(`  → Target "${targetSessionId}" now has ${targetAfter} messages`);
    }

    // --- Phase 2: Delete empty/phantom sessions ---
    const deleteEmpty: string[] = body.deleteEmpty ?? [];

    for (const sessionId of deleteEmpty) {
      const dbId = scopedId(userId, sessionId);

      // Safety: verify session has 0 messages before deleting
      const { count } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", dbId);

      if (count && count > 0) {
        log.push(`\n⚠ Session "${sessionId}" has ${count} messages — NOT deleting (safety check)`);
        continue;
      }

      await supabase
        .from("chat_sessions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", dbId);

      sessionsDeleted++;
      log.push(`\n→ Soft-deleted empty session "${sessionId}"`);
    }

    // --- Phase 3: Cleanup previously-migrated sessions ---
    const cleanup: string[] = body.cleanup ?? [];

    for (const sessionId of cleanup) {
      const dbId = scopedId(userId, sessionId);

      // Safety: verify session has 0 messages before deleting
      const { count: cleanupCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", dbId);

      if (cleanupCount && cleanupCount > 0) {
        log.push(`\n⚠ Session "${sessionId}" still has ${cleanupCount} messages — NOT deleting (safety check)`);
        continue;
      }

      await supabase
        .from("chat_sessions")
        .update({ deleted_at: new Date().toISOString() })
        .eq("id", dbId);

      sessionsDeleted++;
      log.push(`\n→ Soft-deleted migrated session "${sessionId}"`);
    }

    return NextResponse.json({
      status: "completed",
      totalMessagesMoved,
      sessionsMarkedSubtrack,
      sessionsDeleted,
      log,
    });
  } catch (err) {
    console.error("Recovery error:", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
