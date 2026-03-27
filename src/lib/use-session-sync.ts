"use client";

import { useEffect, useRef, useCallback } from "react";
import { useMeterStore, createSession, type ReceiptStatus, type ActionCard, type Attachment, type DebateTurn, type DissectorTurn, type DocumentPreview, type ClarifyingQuestion } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { authFetch } from "@/lib/auth-fetch";
import { useDecisionsStore } from "@/lib/decisions-store";
import { getModel } from "@/lib/models";

const SYNC_INTERVAL = 10_000; // sync every 10 seconds
const SYNC_DEBOUNCE = 2_000; // debounce after message
const MAX_SYNC_PAYLOAD_BYTES = 512_000; // 512KB safety limit for POST sync

// Module-level callback so external code (e.g. chat-view after finalizeResponse)
// can trigger an immediate sync without waiting for the 2s debounce.
let _forceSyncCallback: (() => void) | null = null;

/** Trigger an immediate server sync (bypasses the 2s debounce). */
export function requestImmediateSync() {
  _forceSyncCallback?.();
}

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

  const mapServerMessage = (m: Record<string, unknown>) => {
    let cost = m.cost as number | undefined;
    // Recalculate cost from tokens + model pricing if the server didn't store it
    // (e.g. messages saved before server-side cost calculation was added, or
    // messages saved mid-stream via beacon before the API finished).
    if (cost == null && m.model && ((m.tokens_in as number) || (m.tokens_out as number))) {
      try {
        const modelInfo = getModel(m.model as string);
        cost = ((m.tokens_in as number) ?? 0) * modelInfo.inputPrice
             + ((m.tokens_out as number) ?? 0) * modelInfo.outputPrice;
      } catch { /* unknown model */ }
    }
    return {
      id: m.id as string,
      role: m.role as "user" | "assistant",
      content: (m.content as string) ?? "",
      model: m.model as string | undefined,
      tokensIn: m.tokens_in as number | undefined,
      tokensOut: m.tokens_out as number | undefined,
      cacheCreationTokens: m.cache_creation_tokens as number | undefined,
      cacheReadTokens: m.cache_read_tokens as number | undefined,
      cost,
      confidence: m.confidence as number | undefined,
      settled: m.settled as boolean | undefined,
      receiptStatus: m.receipt_status as ReceiptStatus | undefined,
      cards: m.cards as ActionCard[] | undefined,
      attachments: m.attachments as Attachment[] | undefined,
      debateTrace: m.debate_trace as DebateTurn[] | undefined,
      dissectorTrace: m.dissector_trace as DissectorTurn[] | undefined,
      documents: m.documents as DocumentPreview[] | undefined,
      thinking: m.thinking as string | undefined,
      timestamp: m.timestamp as number,
      isForkPoint: m.is_fork_point as boolean | undefined,
      forkResolution: m.fork_resolution as "merged" | "closed" | undefined,
      pinned: m.pinned as boolean | undefined,
      decisionId: m.decision_id as string | undefined,
      hidden: m.hidden as boolean | undefined,
      clarifyingQuestions: m.clarifying_questions as ClarifyingQuestion[] | undefined,
    };
  };

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
  const auth401CountRef = useRef(0);
  // Track sessions that have permanently failed (e.g. 413) to stop retrying
  const skippedSessionsRef = useRef<Set<string>>(new Set());
  // Track per-session consecutive 500 errors for backoff
  const session500CountRef = useRef<Map<string, number>>(new Map());

  const syncToServer = useCallback(async () => {
    if (!authenticated) return;

    // Read sessions from getState() at call time — NOT from the closure.
    // This is critical: requestImmediateSync() can fire synchronously after
    // addMessage(), before React re-renders. The closure `sessions` would be
    // stale (missing the new message), but getState() always has the latest.
    const currentSessions = useMeterStore.getState().sessions;

    // Create a snapshot hash to avoid unnecessary syncs.
    // Include isStreaming and last message content length so that content
    // updates during streaming (which don't change message count) still
    // trigger a sync — preventing message loss on page refresh.
    const snapshot = JSON.stringify(
      currentSessions.map((p) => {
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

    for (const session of currentSessions) {
      // Skip sessions that have permanently failed (e.g. repeated 413s)
      if (skippedSessionsRef.current.has(session.id)) continue;

      // Skip sessions in 500-error backoff (exponential: skip 2^n sync cycles)
      const err500Count = session500CountRef.current.get(session.id) ?? 0;
      if (err500Count > 0 && Math.random() > 1 / Math.pow(2, Math.min(err500Count, 6))) continue;

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

      // Safety net: if streaming just ended but the finalized "metered" message
      // hasn't been synced yet, include it so it isn't lost on page refresh.
      if (!session.isStreaming && messagesToSync.length === 0 && session.messages.length > 0) {
        const lastMsg = session.messages[session.messages.length - 1];
        if (lastMsg.role === "assistant" && lastMsg.receiptStatus === "metered") {
          messagesToSync = [lastMsg];
        }
      }

      try {
        const sessionMeta = {
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
          ...(isSubtrack ? { isSubtrack: true, parentSessionId, archived: track?.status === "archived", committed: track?.committed ?? false, forkMessageId: track?.forkMessageId } : {}),
        };

        let body = JSON.stringify({ session: sessionMeta, messages: messagesToSync });

        // If payload exceeds the size limit, progressively reduce messages
        if (body.length > MAX_SYNC_PAYLOAD_BYTES && messagesToSync.length > 1) {
          // Try sending only the last 50 messages
          const trimmed = messagesToSync.slice(-50);
          body = JSON.stringify({ session: sessionMeta, messages: trimmed });
        }
        if (body.length > MAX_SYNC_PAYLOAD_BYTES && messagesToSync.length > 0) {
          // Still too big — send metadata only, messages are already persisted from prior syncs
          body = JSON.stringify({ session: sessionMeta, messages: [] });
        }

        const res = await authFetch("/api/sessions", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body,
        });
        if (!res.ok) {
          if (res.status === 401) {
            auth401CountRef.current += 1;
            // Only log out after 2 consecutive 401s to avoid transient DB errors
            if (auth401CountRef.current >= 2) {
              useMeterStore.setState({ authenticated: false, sessionsLoaded: false });
            }
            return;
          }
          // On 413, mark messages as synced to avoid infinite retry with the same payload
          if (res.status === 413) {
            console.warn(`[meter] Session "${session.name}" payload too large (413), skipping message sync`);
            syncedMessageCountRef.current.set(session.id, session.messages.length);
            skippedSessionsRef.current.add(session.id);
            continue;
          }
          // On 500, track per-session errors for exponential backoff
          if (res.status === 500) {
            session500CountRef.current.set(session.id, err500Count + 1);
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
      auth401CountRef.current = 0;
      // Clear per-session 500 counters on success
      session500CountRef.current.clear();
      // Track synced message counts for sendBeacon delta
      for (const session of currentSessions) {
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

  // Poll admin config so model/command changes propagate live
  useEffect(() => {
    if (!authenticated) return;
    const pollAdminConfig = () => {
      authFetch("/api/auth/me")
        .then((r) => (r.ok ? r.json() : null))
        .then((data) => {
          if (!data?.adminConfig) return;
          console.log("[admin-config] poll received:", JSON.stringify(data.adminConfig));
          useMeterStore.getState().setAdminConfig({
            markupMultiplier: data.markupMultiplier,
            enabledModels: data.adminConfig.enabledModels ?? [],
            enabledCommands: data.adminConfig.enabledCommands ?? [],
          });
        })
        .catch(() => {});
    };
    // Fire immediately on mount, then every 15s
    pollAdminConfig();
    const interval = setInterval(pollAdminConfig, 15_000);
    return () => clearInterval(interval);
  }, [authenticated]);

  // Register syncToServer so external callers (requestImmediateSync) can fire it.
  useEffect(() => {
    _forceSyncCallback = syncToServer;
    return () => { _forceSyncCallback = null; };
  }, [syncToServer]);

  // Debounced sync on message changes
  useEffect(() => {
    if (!authenticated) return;

    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(syncToServer, SYNC_DEBOUNCE);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [authenticated, sessions, syncToServer]);

  // Reset daily counters at local midnight
  useEffect(() => {
    if (!authenticated) return;

    resetDailyIfNeeded();
    let timeout: ReturnType<typeof setTimeout> | null = null;
    const schedule = () => {
      const ms = getMsUntilMidnight() + 50;
      timeout = setTimeout(() => {
        resetDailyIfNeeded();
        schedule();
      }, ms);
    };

    schedule();
    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [authenticated, resetDailyIfNeeded]);

  // Sync on page unload
  useEffect(() => {
    if (!authenticated) return;

    const handleBeforeUnload = () => {
      // Flag if any session was streaming (or recently finished streaming)
      // so the next page load can delay the session fetch to avoid racing
      // with the beacon save or server-side stream completion.
      const anyStreaming = sessions.some((s) => s.isStreaming);
      const anyRecentlyStreaming = sessions.some(
        (s) => !s.isStreaming && s.lastStreamEndedAt && (Date.now() - s.lastStreamEndedAt) < 3000
      );
      if (anyStreaming || anyRecentlyStreaming) {
        try { sessionStorage.setItem("meter:was-streaming", "1"); } catch { /* quota */ }
      }

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

        // Safety net: if streaming just ended but the finalized message hasn't
        // been synced yet (the 2s debounce hasn't fired), include it in the
        // beacon so the "metered" version is persisted before page unload.
        if (!session.isStreaming && deltaMessages.length === 0 && session.messages.length > 0) {
          const lastMsg = session.messages[session.messages.length - 1];
          if (lastMsg.role === "assistant" && lastMsg.receiptStatus === "metered") {
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
          sessionMeta.archived = beaconTrack?.status === "archived";
          sessionMeta.committed = beaconTrack?.committed ?? false;
          sessionMeta.forkMessageId = beaconTrack?.forkMessageId;
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

    // iOS Safari does NOT fire "beforeunload" on tab switch or app switch.
    // "pagehide" is the reliable cross-browser event for page lifecycle changes.
    // Listen on both to cover all browsers.
    window.addEventListener("beforeunload", handleBeforeUnload);
    window.addEventListener("pagehide", handleBeforeUnload);
    return () => {
      window.removeEventListener("beforeunload", handleBeforeUnload);
      window.removeEventListener("pagehide", handleBeforeUnload);
    };
  }, [authenticated, sessions]);

  // Re-fetch server state when page becomes visible again (e.g. iOS tab switch).
  // On mobile, the stream likely broke while the page was suspended — the server
  // may have completed the response and saved it to DB. Pulling fresh data
  // recovers the completed messages the client missed.
  useEffect(() => {
    if (!authenticated) return;

    let lastHidden = 0;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
        // Trigger an immediate sync to persist current state before suspension
        syncToServer();
        return;
      }

      // Page became visible — if we were hidden for >2s, re-fetch from server
      // to pick up any responses the server completed while we were suspended.
      if (document.visibilityState === "visible" && Date.now() - lastHidden > 2000) {
        // Small delay to let any in-flight server saves settle
        setTimeout(async () => {
          try {
            const res = await authFetch("/api/sessions");
            if (!res.ok) return;
            const data = await res.json();
            if (!data.sessions?.length) return;

            const store = useMeterStore.getState();
            const serverSessions = data.sessions as ServerSession[];

            // For each session, check if server has messages the client is missing
            // or has completed ("metered") versions of messages that are still
            // "metering" locally (e.g. stream broke during tab suspend).
            for (const serverSess of serverSessions) {
              const serverMessages = Array.isArray(serverSess.messages)
                ? serverSess.messages.map((m: Record<string, unknown>) => mapServerMessage(m))
                : [];
              if (serverMessages.length === 0) continue;

              const localSession = store.sessions.find((s) => s.id === serverSess.id);
              if (!localSession) continue;

              // Don't touch sessions that are actively streaming (including
              // reconnected streams) — merging would corrupt the in-flight state.
              if (localSession.isStreaming) continue;

              let updated = false;
              const mergedMessages = [...localSession.messages];

              for (const sm of serverMessages) {
                const localIdx = mergedMessages.findIndex((m) => m.id === sm.id);
                if (localIdx === -1) {
                  // Server has a message we don't — add it
                  mergedMessages.push(sm);
                  updated = true;
                } else {
                  const local = mergedMessages[localIdx];
                  // Server wins if it has a more advanced receipt status or more content
                  const serverMoreAdvanced =
                    (sm.receiptStatus === "metered" && local.receiptStatus === "metering") ||
                    (sm.receiptStatus === "settled" && local.receiptStatus !== "settled") ||
                    (sm.content && !local.content) ||
                    (sm.content && local.content && sm.content.length > local.content.length && local.receiptStatus === "metering");
                  if (serverMoreAdvanced) {
                    mergedMessages[localIdx] = sm;
                    updated = true;
                  }
                }
              }

              if (updated) {
                mergedMessages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
                useMeterStore.setState((s) => ({
                  sessions: s.sessions.map((sess) =>
                    sess.id === serverSess.id
                      ? { ...sess, messages: mergedMessages }
                      : sess
                  ),
                }));
              }
            }
          } catch {
            // Silent — periodic sync will catch up
          }
        }, 500);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [authenticated, syncToServer]);

  // Load sessions from server on mount
  useEffect(() => {
    if (!authenticated) return;

    let cancelled = false;

    async function loadSessions() {
      try {
        // If any session was streaming when the page unloaded, the beacon/cancel
        // save might still be in flight. Wait briefly to avoid a race condition
        // where we fetch before the partial content is persisted.
        const wasStreaming = sessionStorage.getItem("meter:was-streaming");
        if (wasStreaming) {
          sessionStorage.removeItem("meter:was-streaming");
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
        }
        let res = await authFetch("/api/sessions");
        if (res.status === 401) {
          // Retry once — transient DB errors can cause false 401s
          await new Promise((r) => setTimeout(r, 1000));
          if (cancelled) return;
          res = await authFetch("/api/sessions");
        }
        if (!res.ok) {
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
          // If local sessions are also empty, recreate a default session
          // so the user isn't stuck in an unrecoverable state
          const currentStore = useMeterStore.getState();
          if (currentStore.sessions.length === 0) {
            const fresh = createSession("default", "My Workspace");
            useMeterStore.setState({
              sessions: [fresh],
              activeSessionId: "default",
            });
          }
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

          // Union merge messages by ID, preferring server version when it has
          // more complete data (settlement, receipt status upgrade, or content).
          const receiptRank = (s?: string) => s === "settled" ? 3 : s === "metered" ? 2 : s === "metering" ? 1 : 0;
          const msgMap = new Map(
            localProject.messages.map((m) => [m.id, m]),
          );
          for (const sm of serverProject.messages) {
            const existing = msgMap.get(sm.id);
            if (!existing) {
              msgMap.set(sm.id, sm);
            } else {
              // Server wins if it has:
              // - A more advanced receipt status (metered > metering)
              // - Settlement data the local version lacks
              // - Content when local is empty (broken stream recovery)
              const serverHasBetterStatus = receiptRank(sm.receiptStatus) > receiptRank(existing.receiptStatus);
              const serverHasContent = !!sm.content && !existing.content;
              const serverHasMoreContent = !!sm.content && !!existing.content &&
                sm.content.length > existing.content.length &&
                existing.receiptStatus === "metering";
              if (
                serverHasBetterStatus ||
                serverHasContent ||
                serverHasMoreContent ||
                (sm.settled && !existing.settled)
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
        // with the parent session). We use fork_message_id from either the workspace
        // store (localStorage) or the server (chat_sessions.fork_message_id) as fallback.
        const wsState = useWorkspaceStore.getState();
        for (let i = 0; i < merged.length; i++) {
          const session = merged[i];
          const serverSess = serverSessions.find((s) => s.id === session.id);
          if (!serverSess?.is_subtrack) continue;

          // Get forkMessageId from workspace store or server DB fallback
          const wsTrack = wsState.tracks.find((t) => t.id === session.id && t.isSubtrack);
          const forkMessageId = wsTrack?.forkMessageId ?? (serverSess as Record<string, unknown>).fork_message_id as string | undefined;
          if (!forkMessageId) continue;

          // Find the parent session (either by server's parent_session_id or workspace lookup)
          const parentId = serverSess.parent_session_id
            ?? (wsTrack ? wsState.workspaces.find((w) => w.id === wsTrack.workspaceId)?.sessionId : undefined);
          if (!parentId) continue;

          const parentSession = merged.find((p) => p.id === parentId);
          if (!parentSession) continue;

          // Get parent's messages up to and including the fork point
          const forkIdx = parentSession.messages.findIndex((m) => m.id === forkMessageId);
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

        useMeterStore.setState(() => ({
          sessions: merged,
          activeSessionId: nextActiveSessionId,
        }));
        useMeterStore.getState().resetDailyIfNeeded();

        useWorkspaceStore.getState().upsertWorkspacesFromSessions(serverSessions, nextActiveSessionId);
        useMeterStore.getState().fetchConnectionStatus();

        // Auto-fetch ALL remaining messages for sessions that have more than
        // the initial 20 loaded. This runs in the background so the UI
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

        // ── Stream reconnect ─────────────────────────────────────────────
        // If any session has an assistant message still in "metering" status,
        // the server-side stream is likely still running (or just finished).
        // Reconnect to the resume SSE endpoint to stream content live.
        for (const session of merged) {
          const lastMsg = session.messages[session.messages.length - 1];
          if (
            lastMsg?.role === "assistant" &&
            lastMsg.receiptStatus === "metering"
          ) {
            const reconnectSessionId = session.id;
            const reconnectMessageId = lastMsg.id;

            // Set streaming state so UI shows Brainwave animation
            useMeterStore.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === reconnectSessionId
                  ? { ...sess, isStreaming: true }
                  : sess
              ),
            }));

            // Connect to resume endpoint in the background
            reconnectToStream(reconnectSessionId, reconnectMessageId);
          }
        }
      } catch (err) {
        console.error("[meter] Failed to load sessions from server:", err);
      } finally {
        useMeterStore.getState().setSessionsLoaded(true);
      }
    }

    /** Connect to the resume SSE endpoint to continue streaming a response. */
    async function reconnectToStream(sessionId: string, messageId: string) {
      try {
        const res = await authFetch(
          `/api/chat/resume?messageId=${encodeURIComponent(messageId)}`
        );
        if (!res.ok || !res.body) {
          useMeterStore.getState().setStreaming(false, sessionId);
          return;
        }

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        let buffer = "";
        let fullContent = "";
        let fullThinking = "";

        // Seed with existing content from the DB snapshot (already in the store)
        const existingMsg = useMeterStore
          .getState()
          .sessions.find((s) => s.id === sessionId)
          ?.messages.find((m) => m.id === messageId);
        if (existingMsg) {
          fullContent = existingMsg.content || "";
          fullThinking = existingMsg.thinking || "";
        }

        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const lines = buffer.split("\n");
          buffer = lines.pop() ?? "";

          for (const line of lines) {
            if (!line.startsWith("data: ")) continue;
            try {
              const data = JSON.parse(line.slice(6));

              if (data.type === "delta") {
                fullContent += data.content;
                useMeterStore
                  .getState()
                  .updateReconnectMessageContent(
                    sessionId,
                    messageId,
                    fullContent
                  );
              }
              if (data.type === "thinking_delta") {
                fullThinking += data.content;
                useMeterStore
                  .getState()
                  .updateReconnectMessageThinking(
                    sessionId,
                    messageId,
                    fullThinking
                  );
              }
              if (data.type === "usage") {
                useMeterStore
                  .getState()
                  .finalizeReconnectedMessage(sessionId, messageId, {
                    tokensIn: data.tokensIn,
                    tokensOut: data.tokensOut,
                    cacheCreationTokens: data.cacheCreationTokens,
                    cacheReadTokens: data.cacheReadTokens,
                    cost: data.cost,
                  });
              }
              if (data.type === "done") {
                useMeterStore.getState().setStreaming(false, sessionId);
              }
            } catch {
              // Malformed SSE line — skip
            }
          }
        }

        // Ensure streaming is stopped even if the loop exits without "done"
        useMeterStore.getState().setStreaming(false, sessionId);
      } catch {
        // Resume failed — stop streaming indicator
        useMeterStore.getState().setStreaming(false, sessionId);
      }
    }

    loadSessions();

    // Also load decisions from server (they may not be in localStorage after logout/login)
    useDecisionsStore.getState().fetchDecisions();

    // Refresh user profile data from server (handle, email, card info, etc.)
    // This ensures fields not in localStorage (or stale values) are restored.
    authFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || cancelled) return;
        const store = useMeterStore.getState();
        store.setAuth(
          data.userId,
          data.handle,
          data.email,
          data.accountType,
          data.markupMultiplier,
        );
        if (data.cardOnFile !== undefined) {
          useMeterStore.setState({
            cardOnFile: data.cardOnFile,
            cardLast4: data.cardLast4,
            cardBrand: data.cardBrand,
            stripeCustomerId: data.stripeCustomerId,
            creditBalance: Number(data.creditBalance ?? 0),
          });
        }
        // Apply global admin config (markup, enabled models/commands, free credit)
        if (data.adminConfig) {
          console.log("[admin-config] initial load:", JSON.stringify(data.adminConfig));
          store.setAdminConfig({
            markupMultiplier: data.markupMultiplier,
            enabledModels: data.adminConfig.enabledModels ?? [],
            enabledCommands: data.adminConfig.enabledCommands ?? [],
          });
        }
      })
      .catch(() => { /* silent — localStorage still has basics */ });

    return () => {
      cancelled = true;
    };
  }, [authenticated]);
}
