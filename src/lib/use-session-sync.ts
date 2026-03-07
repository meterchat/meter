"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeterStore, type ReceiptStatus, type ActionCard, type Attachment, type DebateTurn, type DissectorTurn } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { apiUrl } from "@/lib/api-url";
import { useDecisionsStore } from "@/lib/decisions-store";

const SYNC_INTERVAL = 10_000; // sync every 10 seconds
const SYNC_DEBOUNCE = 2_000; // debounce after message

interface ServerSession {
  id: string;
  project_name?: string;
  workspace_name?: string;
  name?: string;
  created_at?: string;
  messages?: Record<string, unknown>[];
  total_cost?: number;
  today_cost?: number;
  today_tokens_in?: number;
  today_tokens_out?: number;
  today_message_count?: number;
  today_date?: string;
  // Track vs workspace
  is_subtrack?: boolean;
  parent_session_id?: string;
  // Pagination aggregates
  total_tokens_in?: number;
  total_tokens_out?: number;
  total_message_count?: number;
  has_more_messages?: boolean;
  [key: string]: unknown;
}

export function useSessionSync() {
  const userId = useMeterStore((s) => s.userId);
  const sessions = useMeterStore((s) => s.sessions);
  const authenticated = useMeterStore((s) => s.authenticated);
  const resetDailyIfNeeded = useMeterStore((s) => s.resetDailyIfNeeded);
  const attemptDailySettlement = useMeterStore((s) => s.attemptDailySettlement);
  const lastSyncRef = useRef<string>("");
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const syncedMessageCountRef = useRef<Map<string, number>>(new Map());
  const todayStr = () => {
    const now = new Date();
    const yyyy = now.getFullYear();
    const mm = String(now.getMonth() + 1).padStart(2, "0");
    const dd = String(now.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  };

  const getMsUntilMidnight = () => {
    const now = new Date();
    const midnight = new Date(now);
    midnight.setHours(24, 0, 0, 0);
    return midnight.getTime() - now.getTime();
  };

  const mapServerMessage = (m: Record<string, unknown>) => ({
    id: m.id as string,
    role: m.role as "user" | "assistant",
    content: (m.content as string) ?? "",
    model: m.model as string | undefined,
    tokensIn: m.tokens_in as number | undefined,
    tokensOut: m.tokens_out as number | undefined,
    cost: m.cost as number | undefined,
    confidence: m.confidence as number | undefined,
    settled: m.settled as boolean | undefined,
    receiptStatus: m.receipt_status as ReceiptStatus | undefined,
    signature: m.signature as string | undefined,
    txHash: m.tx_hash as string | undefined,
    cards: m.cards as ActionCard[] | undefined,
    attachments: m.attachments as Attachment[] | undefined,
    debateTrace: m.debate_trace as DebateTurn[] | undefined,
    dissectorTrace: m.dissector_trace as DissectorTurn[] | undefined,
    thinking: m.thinking as string | undefined,
    timestamp: m.timestamp as number,
    isForkPoint: m.is_fork_point as boolean | undefined,
    forkResolution: m.fork_resolution as "merged" | "closed" | undefined,
  });

  const buildSessionFromServer = (
    session: ServerSession,
    existingConnectedServices?: Record<string, boolean>,
  ) => {
    const messages = Array.isArray(session.messages)
      ? session.messages.map((m: Record<string, unknown>) => mapServerMessage(m))
      : [];
    const totalFromMessages = messages
      .filter((m) => m.role === "assistant" && m.cost != null)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const totalFromSession = Number(session.total_cost ?? 0);

    return {
      id: session.id,
      name: session.workspace_name ?? session.project_name ?? session.name ?? session.id,
      messages,
      isStreaming: false,
      settlementError: null,
      chatBlocked: false,
      todayCost: Number(session.today_cost ?? 0),
      todayTokensIn: Number(session.today_tokens_in ?? 0),
      todayTokensOut: Number(session.today_tokens_out ?? 0),
      todayMessageCount: Number(session.today_message_count ?? 0),
      todayByModel: {},
      todayDate: session.today_date ?? todayStr(),
      weekCost: Number(session.week_cost ?? 0),
      weekKey: (session.week_key as string) ?? undefined,
      monthCost: Number(session.month_cost ?? 0),
      monthKey: (session.month_key as string) ?? undefined,
      totalCost: Math.max(totalFromSession, totalFromMessages),
      currentMessageCost: 0,
      connectedServices: existingConnectedServices ?? {},
      // Pagination state
      hasOlderMessages: session.has_more_messages ?? false,
      loadingOlderMessages: false,
      oldestLoadedTimestamp: messages.length > 0 ? messages[0].timestamp : null,
      serverTokensIn: Number(session.total_tokens_in ?? 0),
      serverTokensOut: Number(session.total_tokens_out ?? 0),
      serverMessageCount: Number(session.total_message_count ?? 0),
      serverPendingBalance: Number(session.pending_balance ?? 0),
    };
  };

  const syncFailCountRef = useRef(0);

  const syncToServer = useCallback(async () => {
    if (!authenticated) return;

    // Create a snapshot hash to avoid unnecessary syncs.
    // Include isStreaming and last message content length so that content
    // updates during streaming (which don't change message count) still
    // trigger a sync — preventing message loss on page refresh.
    const snapshot = JSON.stringify(
      sessions.map((p) => {
        const lastMsg = p.messages[p.messages.length - 1];
        return {
          id: p.id,
          msgCount: p.messages.length,
          lastMsg: lastMsg?.id,
          lastMsgLen: lastMsg?.content?.length ?? 0,
          totalCost: p.totalCost,
          streaming: p.isStreaming,
        };
      })
    );

    if (snapshot === lastSyncRef.current) return;
    let allOk = true;

    // Sync each session to the server.
    // Send only delta messages (new since last successful sync) to avoid
    // multi-MB payloads for sessions with thousands of messages.
    // Look up workspace store to determine if a session is a subtrack
    const wsTracks = useWorkspaceStore.getState().tracks;
    const wsWorkspaces = useWorkspaceStore.getState().workspaces;

    for (const session of sessions) {
      const syncedCount = syncedMessageCountRef.current.get(session.id) ?? 0;

      // Determine if this session is a subtrack by checking workspace store tracks
      const track = wsTracks.find((t) => t.id === session.id && t.isSubtrack);
      const isSubtrack = !!track;
      // Find the parent workspace's session ID for subtracks
      let parentSessionId: string | undefined;
      if (isSubtrack && track) {
        const parentWs = wsWorkspaces.find((w) => w.id === track.workspaceId);
        parentSessionId = parentWs?.sessionId ?? undefined;
      }

      // For subtracks, NEVER sync pre-fork messages — they share IDs with
      // the parent session and upsert would reassign them to this subtrack's
      // session_id, wiping them from main. Only sync post-fork messages.
      let messagesToSync: typeof session.messages;
      if (isSubtrack && track?.forkMessageId) {
        const forkIdx = session.messages.findIndex((m) => m.id === track.forkMessageId);
        const postForkMessages = forkIdx === -1 ? [] : session.messages.slice(forkIdx + 1);
        // Apply delta logic on post-fork messages only
        const postForkSyncedCount = Math.max(0, syncedCount - (forkIdx + 1));
        messagesToSync = postForkSyncedCount === 0
          ? postForkMessages
          : postForkMessages.slice(postForkSyncedCount);
      } else {
        // On first sync (syncedCount=0) send all messages; otherwise only new ones.
        // Server upserts by message ID, so resending existing ones is safe but wasteful.
        messagesToSync = syncedCount === 0
          ? (session.messages ?? [])
          : session.messages.slice(syncedCount);
      }

      // During streaming, always resend the last assistant message even if it was
      // already synced — its content has changed since the last sync.
      if (session.isStreaming && messagesToSync.length === 0 && session.messages.length > 0) {
        const lastMsg = session.messages[session.messages.length - 1];
        if (lastMsg.role === "assistant") {
          messagesToSync = [lastMsg];
        }
      }

      try {
        const res = await fetch(apiUrl("/api/sessions"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            session: {
              id: session.id,
              name: session.name,
              totalCost: session.totalCost,
              todayCost: session.todayCost,
              todayTokensIn: session.todayTokensIn,
              todayTokensOut: session.todayTokensOut,
              todayMessageCount: session.todayMessageCount,
              todayDate: session.todayDate,
              weekCost: session.weekCost ?? 0,
              weekKey: session.weekKey,
              monthCost: session.monthCost ?? 0,
              monthKey: session.monthKey,
              ...(isSubtrack ? { isSubtrack: true, parentSessionId } : {}),
            },
            messages: messagesToSync,
          }),
        });
        if (!res.ok) {
          if (res.status === 401) {
            useMeterStore.setState({ authenticated: false, sessionsLoaded: false });
            return;
          }
          console.warn(`[meter] Session sync failed for "${session.name}": ${res.status}`);
          allOk = false;
        }
      } catch (err) {
        console.warn("[meter] Session sync error:", err);
        allOk = false;
      }
    }

    if (allOk) {
      lastSyncRef.current = snapshot;
      syncFailCountRef.current = 0;
      // Track synced message counts for sendBeacon delta
      for (const session of sessions) {
        syncedMessageCountRef.current.set(session.id, session.messages.length);
      }
    } else {
      syncFailCountRef.current += 1;
      if (syncFailCountRef.current >= 3) {
        console.error(
          `[meter] Session sync has failed ${syncFailCountRef.current} consecutive times. Messages may not be saved to the server.`
        );
      }
    }
  }, [authenticated, sessions]);

  // Periodic sync
  useEffect(() => {
    if (!authenticated) return;

    const interval = setInterval(syncToServer, SYNC_INTERVAL);
    return () => clearInterval(interval);
  }, [authenticated, syncToServer]);

  // Debounced sync on message changes
  useEffect(() => {
    if (!authenticated) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(syncToServer, SYNC_DEBOUNCE);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [authenticated, sessions, syncToServer]);

  // Reset daily counters at local midnight + attempt settlement
  useEffect(() => {
    if (!authenticated) return;

    resetDailyIfNeeded();
    attemptDailySettlement();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const ms = getMsUntilMidnight() + 50;
      timeout = setTimeout(() => {
        resetDailyIfNeeded();
        attemptDailySettlement();
        schedule();
      }, ms);
    };

    schedule();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [authenticated, resetDailyIfNeeded, attemptDailySettlement]);

  // Sync on page unload
  useEffect(() => {
    if (!authenticated) return;

    const handleBeforeUnload = () => {
      // Send only delta messages since last successful sync to stay under
      // the ~64KB sendBeacon payload limit.
      const beaconTracks = useWorkspaceStore.getState().tracks;
      const beaconWorkspaces = useWorkspaceStore.getState().workspaces;

      for (const session of sessions) {
        const syncedCount = syncedMessageCountRef.current.get(session.id) ?? 0;

        // Check if this session is a subtrack
        const beaconTrack = beaconTracks.find((t) => t.id === session.id && t.isSubtrack);
        const beaconIsSubtrack = !!beaconTrack;
        let beaconParentSessionId: string | undefined;
        if (beaconIsSubtrack && beaconTrack) {
          const parentWs = beaconWorkspaces.find((w) => w.id === beaconTrack.workspaceId);
          beaconParentSessionId = parentWs?.sessionId ?? undefined;
        }

        // For subtracks, only send post-fork messages (same logic as periodic sync)
        let deltaMessages: typeof session.messages;
        if (beaconIsSubtrack && beaconTrack?.forkMessageId) {
          const forkIdx = session.messages.findIndex((m) => m.id === beaconTrack.forkMessageId);
          const postForkMessages = forkIdx === -1 ? [] : session.messages.slice(forkIdx + 1);
          const postForkSyncedCount = Math.max(0, syncedCount - (forkIdx + 1));
          deltaMessages = postForkSyncedCount === 0
            ? postForkMessages
            : postForkMessages.slice(postForkSyncedCount);
        } else {
          deltaMessages = session.messages.slice(syncedCount);
        }

        // During streaming, always include the last assistant message in the
        // beacon so in-progress content is preserved after page refresh.
        if (session.isStreaming && deltaMessages.length === 0 && session.messages.length > 0) {
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg.role === "assistant") {
            deltaMessages = [lastMsg];
          }
        }

        const sessionMeta: Record<string, unknown> = {
          id: session.id,
          name: session.name,
          totalCost: session.totalCost,
          todayCost: session.todayCost,
          todayTokensIn: session.todayTokensIn,
          todayTokensOut: session.todayTokensOut,
          todayMessageCount: session.todayMessageCount,
          todayDate: session.todayDate,
          weekCost: session.weekCost ?? 0,
          weekKey: session.weekKey,
          monthCost: session.monthCost ?? 0,
          monthKey: session.monthKey,
        };
        if (beaconIsSubtrack) {
          sessionMeta.isSubtrack = true;
          sessionMeta.parentSessionId = beaconParentSessionId;
        }

        const payload = JSON.stringify({
          session: sessionMeta,
          messages: deltaMessages,
        });

        // Safety: if payload still exceeds ~60KB, truncate to last N messages that fit
        const MAX_BEACON_BYTES = 60_000;
        let blob: Blob;
        if (payload.length > MAX_BEACON_BYTES && deltaMessages.length > 1) {
          // Send only session metadata (guaranteed small) — periodic sync handles messages
          const metaOnly = JSON.stringify({
            session: sessionMeta,
            messages: [],
          });
          blob = new Blob([metaOnly], { type: "application/json" });
        } else {
          blob = new Blob([payload], { type: "application/json" });
        }

        navigator.sendBeacon("/api/sessions", blob);
      }
    };

    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [authenticated, sessions]);

  // Load sessions from server on mount
  useEffect(() => {
    if (!authenticated) return;

    let cancelled = false;

    async function loadSessions() {
      try {
        const res = await fetch(apiUrl("/api/sessions"));
        if (!res.ok) {
          // Server session expired — clear client auth so user re-authenticates
          if (res.status === 401) {
            useMeterStore.setState({ authenticated: false, sessionsLoaded: false });
            return;
          }
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }
        const data = await res.json();

        if (cancelled) return;

        if (!data.sessions?.length) {
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }

        const store = useMeterStore.getState();
        const serverSessions = data.sessions as ServerSession[];

        const localById = new Map(store.sessions.map((p) => [p.id, p]));
        const serverById = new Map(serverSessions.map((s) => [s.id as string, s]));

        // Union merge: combine local and server sessions, merging messages by ID
        const merged: ReturnType<typeof buildSessionFromServer>[] = [];

        // Process all server sessions (merge with local if exists)
        for (const serverSession of serverSessions) {
          const serverId = serverSession.id as string;
          const localProject = localById.get(serverId);
          const serverProject = buildSessionFromServer(
            serverSession,
            localProject?.connectedServices,
          );

          if (!localProject) {
            // No local data at all — use server as-is
            merged.push(serverProject);
            continue;
          }

          if (localProject.messages.length === 0) {
            // Local has no messages (stripped from localStorage) — use server messages
            // but preserve the higher of local vs server cost/counter metadata
            const lp = localProject as Record<string, unknown>;
            merged.push({
              ...serverProject,
              todayCost: Math.max(serverProject.todayCost, (lp.todayCost as number) ?? 0),
              todayTokensIn: Math.max(serverProject.todayTokensIn, (lp.todayTokensIn as number) ?? 0),
              todayTokensOut: Math.max(serverProject.todayTokensOut, (lp.todayTokensOut as number) ?? 0),
              todayMessageCount: Math.max(serverProject.todayMessageCount, (lp.todayMessageCount as number) ?? 0),
              totalCost: Math.max(serverProject.totalCost, (lp.totalCost as number) ?? 0),
              weekCost: Math.max(serverProject.weekCost ?? 0, (lp.weekCost as number) ?? 0),
              weekKey: serverProject.weekKey ?? (lp.weekKey as string) ?? undefined,
              monthCost: Math.max(serverProject.monthCost ?? 0, (lp.monthCost as number) ?? 0),
              monthKey: serverProject.monthKey ?? (lp.monthKey as string) ?? undefined,
              connectedServices: localProject.connectedServices ?? {},
            });
            continue;
          }

          // Union merge messages by ID, preferring server version (has settlement data)
          const msgMap = new Map(
            localProject.messages.map((m) => [m.id, m]),
          );
          for (const sm of serverProject.messages) {
            const existing = msgMap.get(sm.id);
            if (!existing) {
              msgMap.set(sm.id, sm);
            } else {
              // Server wins if it has settlement/receipt fields the local version lacks
              if (
                (sm.settled && !existing.settled) ||
                (sm.receiptStatus && !existing.receiptStatus)
              ) {
                msgMap.set(sm.id, sm);
              }
            }
          }

          const mergedMessages = Array.from(msgMap.values()).sort(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
          );

          merged.push({
            ...serverProject,
            messages: mergedMessages,
            totalCost: Math.max(serverProject.totalCost, localProject.totalCost),
            connectedServices: localProject.connectedServices ?? {},
          });
        }

        // Keep local-only sessions (not yet synced to server)
        for (const localProject of store.sessions) {
          if (!serverById.has(localProject.id)) {
            merged.push(localProject as ReturnType<typeof buildSessionFromServer>);
          }
        }

        // Choose the best active project:
        // If current active project is a bare default with no messages and the server
        // returned sessions with actual content, switch to the most recently used one.
        const currentInMerged = merged.find((p) => p.id === store.activeSessionId);
        const currentIsEmpty = currentInMerged && currentInMerged.messages.length === 0 && currentInMerged.totalCost === 0;
        const serverHasContent = merged.some((p) => p.id !== store.activeSessionId && (p.messages.length > 0 || p.totalCost > 0));

        let nextActiveSessionId: string;
        if (currentInMerged && !currentIsEmpty) {
          nextActiveSessionId = store.activeSessionId;
        } else if (currentIsEmpty && serverHasContent) {
          // Prefer a server session with content over an empty default
          const best = merged.find((p) => p.id !== store.activeSessionId && (p.messages.length > 0 || p.totalCost > 0));
          nextActiveSessionId = best?.id ?? store.activeSessionId;
        } else {
          nextActiveSessionId = merged[0]?.id ?? store.activeSessionId;
        }

        // Reconstruct subtrack sessions: prepend parent's pre-fork messages.
        // Server only stores post-fork messages for subtracks (to avoid ID conflicts
        // with the parent session). The workspace store tracks tell us the fork point.
        const wsState = useWorkspaceStore.getState();
        for (let i = 0; i < merged.length; i++) {
          const session = merged[i];
          const serverSess = serverSessions.find((s) => s.id === session.id);
          if (!serverSess?.is_subtrack) continue;

          // Find the track in workspace store to get the forkMessageId
          const wsTrack = wsState.tracks.find((t) => t.id === session.id && t.isSubtrack);
          if (!wsTrack?.forkMessageId) continue;

          // Find the parent session (either by server's parent_session_id or workspace lookup)
          const parentId = serverSess.parent_session_id
            ?? wsState.workspaces.find((w) => w.id === wsTrack.workspaceId)?.sessionId;
          if (!parentId) continue;

          const parentSession = merged.find((p) => p.id === parentId);
          if (!parentSession) continue;

          // Get parent's messages up to and including the fork point
          const forkIdx = parentSession.messages.findIndex((m) => m.id === wsTrack.forkMessageId);
          if (forkIdx === -1) continue;

          const preForkMessages = parentSession.messages.slice(0, forkIdx + 1);

          // Check if the subtrack already has pre-fork messages (from local state)
          const firstSubtrackMsg = session.messages[0];
          const alreadyHasPreFork = firstSubtrackMsg && preForkMessages.some((m) => m.id === firstSubtrackMsg.id);
          if (alreadyHasPreFork) continue;

          // Prepend parent's pre-fork messages
          merged[i] = {
            ...session,
            messages: [...preForkMessages.map((m) => ({ ...m })), ...session.messages],
          };
        }

        // Clean up stale "signing" messages from interrupted streams.
        // If a message has content, upgrade to "signed". If empty shell, remove it.
        const cleanedMerged = merged.map((p) => ({
          ...p,
          messages: p.messages
            .filter((m) => !(m.role === "assistant" && !m.content && m.receiptStatus === "signing"))
            .map((m) => (m.role === "assistant" && m.receiptStatus === "signing" && m.content)
              ? { ...m, receiptStatus: "signed" as const }
              : m
            ),
        }));

        useMeterStore.setState(() => ({
          sessions: cleanedMerged,
          activeSessionId: nextActiveSessionId,
        }));
        useMeterStore.getState().resetDailyIfNeeded();
        useMeterStore.getState().attemptDailySettlement();

        useWorkspaceStore.getState().upsertWorkspacesFromSessions(serverSessions, nextActiveSessionId);
        useMeterStore.getState().fetchConnectionStatus();

        // Auto-fetch ALL remaining messages for sessions that have more than
        // the initial 200 loaded. This runs in the background so the UI
        // is responsive immediately, and messages fill in as they arrive.
        // We loop fetchOlderMessages until hasOlderMessages becomes false.
        for (const session of serverSessions) {
          if (session.has_more_messages) {
            const sessionId = session.id as string;
            (async () => {
              try {
                let hasMore = true;
                while (hasMore) {
                  await useMeterStore.getState().fetchOlderMessages(sessionId);
                  const proj = useMeterStore.getState().sessions.find((p) => p.id === sessionId);
                  hasMore = proj?.hasOlderMessages ?? false;
                }
              } catch {
                // Background fetch — don't block login on failure
              }
            })();
          }
        }
      } catch (err) {
        console.error("[meter] Failed to load sessions from server:", err);
      } finally {
        useMeterStore.getState().setSessionsLoaded(true);
      }
    }

    loadSessions();

    // Also load decisions from server (they may not be in localStorage after logout/login)
    useDecisionsStore.getState().fetchDecisions();

    return () => {
      cancelled = true;
    };
  }, [authenticated]);
}
