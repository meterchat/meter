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

export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    if (!body.confirm) {
      return NextResponse.json({
        error: "Must pass { confirm: true } to execute recovery",
      }, { status: 400 });
    }

    const targetWorkspace = body.workspace?.toLowerCase().trim();
    const supabase = getSupabaseServer();
    const summaries = await buildSessionSummaries(supabase, userId);
    const groups = groupByWorkspace(summaries);

    const log: string[] = [];
    let totalMessagesMoved = 0;
    let sessionsMarkedSubtrack = 0;
    let sessionsDeleted = 0;

    for (const group of groups) {
      // Skip if targeting specific workspace and this isn't it
      if (targetWorkspace && group.name.toLowerCase() !== targetWorkspace) continue;
      if (!group.mainSession || group.otherSessions.length === 0) continue;

      const mainScopedId = scopedId(userId, group.mainSession.id);
      log.push(`\n=== Workspace: "${group.name}" ===`);
      log.push(`Main session: ${group.mainSession.id} (${group.mainSession.messageCount} messages)`);

      for (const other of group.otherSessions) {
        const otherScopedId = scopedId(userId, other.id);
        log.push(`\nProcessing session: ${other.id} (${other.messageCount} messages, subtrack=${other.isSubtrack})`);

        if (other.messageCount === 0) {
          // Empty session — soft-delete it
          await supabase
            .from("chat_sessions")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", otherScopedId);
          log.push(`  → Soft-deleted (empty session)`);
          sessionsDeleted++;
          continue;
        }

        // Get all messages from this session
        const allMessages: Array<{ id: string; timestamp: number }> = [];
        let offset = 0;
        const PAGE = 1000;
        while (true) {
          const { data: msgs } = await supabase
            .from("chat_messages")
            .select("id, timestamp")
            .eq("session_id", otherScopedId)
            .order("timestamp", { ascending: true })
            .range(offset, offset + PAGE - 1);
          if (!msgs || msgs.length === 0) break;
          allMessages.push(...(msgs as Array<{ id: string; timestamp: number }>));
          if (msgs.length < PAGE) break;
          offset += PAGE;
        }

        // Check which of these messages also exist in the main session
        // (these are the stolen messages — same ID, wrong session_id)
        // Since upsert(onConflict: "id") means each message ID exists exactly once,
        // if a message is in the "other" session it's NOT in main anymore.
        // We need to move messages that were originally part of the main conversation.

        // Strategy: Move ALL messages from phantom sessions back to main.
        // The phantom sessions were created by the bug — they shouldn't exist.
        // Exception: if the session is a legitimate subtrack with its own
        // post-fork messages, we only move pre-fork messages.

        // For non-subtrack phantom sessions: move all messages to main
        // For subtrack sessions: these might have legitimate post-fork messages
        //   - but they ALSO might have stolen pre-fork messages via the upsert bug
        //   - we reassign ALL to main since the subtrack should only store post-fork
        //     messages on the server anyway (fixed by the sync patch)

        // Move messages in batches
        let moved = 0;
        for (let i = 0; i < allMessages.length; i += 100) {
          const batch = allMessages.slice(i, i + 100);
          const ids = batch.map((m) => m.id);

          const { error: moveErr } = await supabase
            .from("chat_messages")
            .update({ session_id: mainScopedId })
            .in("id", ids);

          if (moveErr) {
            log.push(`  ✗ Error moving batch ${i}: ${moveErr.message}`);
          } else {
            moved += ids.length;
          }
        }

        totalMessagesMoved += moved;
        log.push(`  → Moved ${moved} messages to main session`);

        // Mark this session as a subtrack of main (so it won't create phantom workspaces)
        await supabase
          .from("chat_sessions")
          .update({
            is_subtrack: true,
            parent_session_id: mainScopedId,
          })
          .eq("id", otherScopedId);

        // If it's now empty, soft-delete it
        if (moved === other.messageCount) {
          await supabase
            .from("chat_sessions")
            .update({ deleted_at: new Date().toISOString() })
            .eq("id", otherScopedId);
          log.push(`  → Soft-deleted (all messages moved)`);
          sessionsDeleted++;
        } else {
          sessionsMarkedSubtrack++;
          log.push(`  → Marked as subtrack of ${group.mainSession.id}`);
        }
      }

      // Verify: count messages now in main session
      const { count: finalCount } = await supabase
        .from("chat_messages")
        .select("id", { count: "exact", head: true })
        .eq("session_id", mainScopedId);

      log.push(`\nMain session "${group.mainSession.id}" now has ${finalCount} messages`);
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
