"use client";

import { useEffect } from "react";
import { useMeterStore, createSession, type ReceiptStatus, type ActionCard, type Attachment, type DebateTurn, type DissectorTurn, type SimplifierTurn, type DocumentPreview, type ClarifyingQuestion } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { authFetch } from "@/lib/auth-fetch";
import { useDecisionsStore } from "@/lib/decisions-store";
import { getModel } from "@/lib/models";

// ── Helpers ──────────────────────────────────────────────────────────────────

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
  is_subtrack?: boolean;
  parent_session_id?: string;
  total_tokens_in?: number;
  total_tokens_out?: number;
  total_message_count?: number;
  has_more_messages?: boolean;
  [key: string]: unknown;
}

const todayStr = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
};

const getMsUntilMidnight = () => {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
};

const mapServerMessage = (m: Record<string, unknown>) => {
  let cost = m.cost as number | undefined;
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
    simplifierTrace: m.simplifier_trace as SimplifierTurn[] | undefined,
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
    hasOlderMessages: session.has_more_messages ?? false,
    loadingOlderMessages: false,
    oldestLoadedTimestamp: messages.length > 0 ? messages[0].timestamp : null,
    serverTokensIn: Number(session.total_tokens_in ?? 0),
    serverTokensOut: Number(session.total_tokens_out ?? 0),
    serverMessageCount: Number(session.total_message_count ?? 0),
    serverPendingBalance: Number(session.pending_balance ?? 0),
  };
};

// ── Hook ─────────────────────────────────────────────────────────────────────

export function useSessionSync() {
  const authenticated = useMeterStore((s) => s.authenticated);
  const resetDailyIfNeeded = useMeterStore((s) => s.resetDailyIfNeeded);

  // ── Poll admin config so model/command changes propagate live ──
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
    pollAdminConfig();
    const interval = setInterval(pollAdminConfig, 15_000);
    return () => clearInterval(interval);
  }, [authenticated]);

  // ── Reset daily counters at local midnight ──
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
    return () => { if (timeout) clearTimeout(timeout); };
  }, [authenticated, resetDailyIfNeeded]);

  // ── Re-fetch from server when tab becomes visible after >2s ──
  useEffect(() => {
    if (!authenticated) return;
    let lastHidden = 0;

    const handleVisibilityChange = () => {
      if (document.visibilityState === "hidden") {
        lastHidden = Date.now();
        return;
      }
      if (document.visibilityState === "visible" && Date.now() - lastHidden > 2000) {
        setTimeout(async () => {
          try {
            const res = await authFetch("/api/sessions");
            if (!res.ok) return;
            const data = await res.json();
            if (!data.sessions?.length) return;

            const store = useMeterStore.getState();
            const serverSessions = data.sessions as ServerSession[];

            for (const serverSess of serverSessions) {
              const serverMessages = Array.isArray(serverSess.messages)
                ? serverSess.messages.map((m: Record<string, unknown>) => mapServerMessage(m))
                : [];
              if (serverMessages.length === 0) continue;

              const localSession = store.sessions.find((s) => s.id === serverSess.id);
              if (!localSession) continue;
              if (localSession.isStreaming) continue;

              // Server is authoritative — replace local messages
              const mergedMessages = [...serverMessages];

              // Keep any local-only messages not yet on server (just sent)
              for (const lm of localSession.messages) {
                if (!mergedMessages.some((sm) => sm.id === lm.id)) {
                  mergedMessages.push(lm);
                }
              }

              mergedMessages.sort((a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0));
              useMeterStore.setState((s) => ({
                sessions: s.sessions.map((sess) =>
                  sess.id === serverSess.id
                    ? { ...sess, messages: mergedMessages }
                    : sess
                ),
              }));
            }
          } catch {
            // Silent — server is authoritative, retry on next visibility change
          }
        }, 500);
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () => document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, [authenticated]);

  // ── Load sessions from server on mount ──
  useEffect(() => {
    if (!authenticated) return;
    let cancelled = false;

    async function loadSessions() {
      try {
        // If any session was streaming when the page unloaded, the server
        // may still be writing. Wait briefly to avoid racing.
        const wasStreaming = sessionStorage.getItem("meter:was-streaming");
        if (wasStreaming) {
          sessionStorage.removeItem("meter:was-streaming");
          await new Promise((r) => setTimeout(r, 500));
          if (cancelled) return;
        }

        let res: Response | null = null;
        for (let attempt = 0; attempt < 3; attempt++) {
          if (cancelled) return;
          try {
            res = await authFetch("/api/sessions");
          } catch {
            await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
            continue;
          }
          if (res.status === 401 && attempt === 0) {
            await new Promise((r) => setTimeout(r, 1000));
            continue;
          }
          if (res.ok) break;
          await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        }

        if (!res || !res.ok) {
          if (res?.status === 401) {
            useMeterStore.setState({ authenticated: false, sessionsLoaded: false });
            return;
          }
          console.error("[meter] Failed to load sessions after 3 attempts — status:", res?.status);
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }

        const data = await res.json();
        if (cancelled) return;

        if (!data.sessions?.length) {
          const currentStore = useMeterStore.getState();
          if (currentStore.sessions.length === 0) {
            const fresh = createSession("default", "My Workspace");
            useMeterStore.setState({ sessions: [fresh], activeSessionId: "default" });
          }
          useMeterStore.getState().setSessionsLoaded(true);
          return;
        }

        const store = useMeterStore.getState();
        const serverSessions = data.sessions as ServerSession[];

        // Server is authoritative — build sessions from server data.
        // Preserve local connectedServices (not stored server-side).
        const localById = new Map(store.sessions.map((p) => [p.id, p]));
        const merged: ReturnType<typeof buildSessionFromServer>[] = [];

        for (const serverSession of serverSessions) {
          const serverId = serverSession.id as string;
          const localProject = localById.get(serverId);
          const serverProject = buildSessionFromServer(
            serverSession,
            localProject?.connectedServices,
          );

          if (!localProject) {
            merged.push(serverProject);
            continue;
          }

          // Merge: server messages are authoritative, but keep local-only
          // messages (just sent, not yet saved by /api/chat) by ID
          const receiptRank = (s?: string) => s === "settled" ? 3 : s === "metered" ? 2 : s === "metering" ? 1 : 0;
          const msgMap = new Map(
            serverProject.messages.map((m) => [m.id, m]),
          );
          for (const lm of localProject.messages) {
            const existing = msgMap.get(lm.id);
            if (!existing) {
              // Local-only message (just sent, /api/chat hasn't saved yet)
              msgMap.set(lm.id, lm);
            } else if (receiptRank(lm.receiptStatus) > receiptRank(existing.receiptStatus)) {
              // Local has more advanced status (rare edge case)
              msgMap.set(lm.id, lm);
            }
          }

          const mergedMessages = Array.from(msgMap.values()).sort(
            (a, b) => (a.timestamp ?? 0) - (b.timestamp ?? 0),
          );

          merged.push({
            ...serverProject,
            messages: mergedMessages,
            connectedServices: localProject.connectedServices ?? {},
          });
        }

        // Keep the user on whatever session they had active
        const currentInMerged = merged.find((p) => p.id === store.activeSessionId);
        const nextActiveSessionId = currentInMerged
          ? store.activeSessionId
          : merged[0]?.id ?? store.activeSessionId;

        // Reconstruct subtrack sessions: prepend parent's pre-fork messages
        const wsState = useWorkspaceStore.getState();
        for (let i = 0; i < merged.length; i++) {
          const session = merged[i];
          const serverSess = serverSessions.find((s) => s.id === session.id);
          if (!serverSess?.is_subtrack) continue;

          const wsTrack = wsState.tracks.find((t) => t.id === session.id && t.isSubtrack);
          const forkMessageId = wsTrack?.forkMessageId ?? (serverSess as Record<string, unknown>).fork_message_id as string | undefined;
          if (!forkMessageId) continue;

          const parentId = serverSess.parent_session_id
            ?? (wsTrack ? wsState.workspaces.find((w) => w.id === wsTrack.workspaceId)?.sessionId : undefined);
          if (!parentId) continue;

          const parentSession = merged.find((p) => p.id === parentId);
          if (!parentSession) continue;

          const forkIdx = parentSession.messages.findIndex((m) => m.id === forkMessageId);
          if (forkIdx === -1) continue;

          const preForkMessages = parentSession.messages.slice(0, forkIdx + 1);
          const firstSubtrackMsg = session.messages[0];
          const alreadyHasPreFork = firstSubtrackMsg && preForkMessages.some((m) => m.id === firstSubtrackMsg.id);
          if (alreadyHasPreFork) continue;

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

        // Auto-fetch ALL remaining messages for sessions with pagination
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
              } catch { /* background fetch */ }
            })();
          }
        }

        // ── Stream reconnect ──
        // If any session has a "metering" assistant message, the server-side
        // stream is likely still running. Reconnect via the resume endpoint.
        for (const session of merged) {
          const lastMsg = session.messages[session.messages.length - 1];
          if (
            lastMsg?.role === "assistant" &&
            lastMsg.receiptStatus === "metering"
          ) {
            const reconnectSessionId = session.id;
            const reconnectMessageId = lastMsg.id;

            useMeterStore.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === reconnectSessionId
                  ? { ...sess, isStreaming: true }
                  : sess
              ),
            }));

            reconnectToStream(reconnectSessionId, reconnectMessageId);
          }
        }
      } catch (err) {
        console.error("[meter] Failed to load sessions from server:", err);
      } finally {
        useMeterStore.getState().setSessionsLoaded(true);
      }
    }

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
        let receivedUsage = false;

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
                useMeterStore.getState().updateReconnectMessageContent(sessionId, messageId, fullContent);
              }
              if (data.type === "thinking_delta") {
                fullThinking += data.content;
                useMeterStore.getState().updateReconnectMessageThinking(sessionId, messageId, fullThinking);
              }
              if (data.type === "usage") {
                receivedUsage = true;
                useMeterStore.getState().finalizeReconnectedMessage(sessionId, messageId, {
                  tokensIn: data.tokensIn,
                  tokensOut: data.tokensOut,
                  cacheCreationTokens: data.cacheCreationTokens,
                  cacheReadTokens: data.cacheReadTokens,
                  cost: data.cost,
                });
              }
              if (data.type === "done") {
                if (!receivedUsage) {
                  useMeterStore.getState().finalizeReconnectedMessage(sessionId, messageId, {
                    tokensIn: existingMsg?.tokensIn,
                    tokensOut: existingMsg?.tokensOut,
                    cost: existingMsg?.cost,
                  });
                }
                useMeterStore.getState().setStreaming(false, sessionId);
              }
            } catch { /* malformed SSE line */ }
          }
        }

        useMeterStore.getState().setStreaming(false, sessionId);
      } catch {
        useMeterStore.getState().setStreaming(false, sessionId);
      }
    }

    loadSessions();

    useDecisionsStore.getState().fetchDecisions();

    authFetch("/api/auth/me")
      .then((r) => (r.ok ? r.json() : null))
      .then((data) => {
        if (!data || cancelled) return;
        const store = useMeterStore.getState();
        store.setAuth(data.userId, data.handle, data.email, data.accountType, data.markupMultiplier);
        if (data.cardOnFile !== undefined) {
          useMeterStore.setState({
            cardOnFile: data.cardOnFile,
            cardLast4: data.cardLast4,
            cardBrand: data.cardBrand,
            stripeCustomerId: data.stripeCustomerId,
            creditBalance: Number(data.creditBalance ?? 0),
          });
        }
        if (data.adminConfig) {
          console.log("[admin-config] initial load:", JSON.stringify(data.adminConfig));
          store.setAdminConfig({
            markupMultiplier: data.markupMultiplier,
            enabledModels: data.adminConfig.enabledModels ?? [],
            enabledCommands: data.adminConfig.enabledCommands ?? [],
          });
        }
      })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [authenticated]);
}
