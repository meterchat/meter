# PR4: Bootstrap + Realtime Subscriptions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the sync-based read path with Supabase Realtime subscriptions. The client bootstraps from the server, subscribes to three channels (sessions, messages, runs), and receives live updates. Stream resume works via Realtime instead of the custom `/api/chat/resume` endpoint.

**Architecture:** A new `useRealtimeSync` hook replaces the read-path parts of `useSessionSync`. It follows a three-step pattern: bootstrap fetch → subscribe → reconciliation fetch. The sending device still gets fast SSE directly from `/api/chat`; other devices and refreshed tabs get updates via Realtime. localStorage stops persisting messages and sessions.

**Tech Stack:** Supabase Realtime (Postgres Changes), Zustand, Next.js React hooks.

**Spec:** `docs/superpowers/specs/2026-04-04-server-authoritative-state-design.md` — Section 4

**Depends on:** PR1 (Realtime auth), PR2 (server workspace IDs), PR3 (server message IDs + runs).

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/use-realtime-sync.ts` | Create | Bootstrap + three Realtime channels + reconciliation + session switching + token refresh |
| `src/lib/store.ts` | Modify | Shrink `partialize` to UI prefs only; add `setSessionsFromServer` bulk setter |
| `src/components/app-shell.tsx` or equivalent | Modify | Replace `useSessionSync()` call with `useRealtimeSync()` |
| `src/app/api/sessions/route.ts` | Modify | Add `active_runs` to GET response for authoritative stream liveness detection |

---

## Task 1: Add `setSessionsFromServer` bulk setter to store

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add the action to the MeterState interface**

After the `setSessionsLoaded` action declaration:

```typescript
  setSessionsFromServer: (sessions: Session[]) => void;
```

- [ ] **Step 2: Add the implementation**

After the `setSessionsLoaded` implementation:

```typescript
      setSessionsFromServer: (sessions) =>
        set({ sessions, sessionsLoaded: true }),
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: add setSessionsFromServer bulk setter for Realtime bootstrap"
```

---

## Task 2: Create `useRealtimeSync` hook

**Files:**
- Create: `src/lib/use-realtime-sync.ts`

This is the core of PR4. The hook handles:
1. Bootstrap fetch from `GET /api/sessions`
2. Three Realtime subscriptions (sessions, messages, runs)
3. Reconciliation fetch after subscriptions are live
4. Session switching (resubscribe to new session's messages/runs)
5. Token refresh every 50 minutes

- [ ] **Step 1: Create the hook file**

```typescript
// src/lib/use-realtime-sync.ts
"use client";

import { useEffect, useRef, useCallback } from "react";
import type { RealtimeChannel, RealtimePostgresChangesPayload } from "@supabase/supabase-js";
import { useMeterStore, createSession, type ChatMessage, type ReceiptStatus } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore } from "@/lib/decisions-store";
import { authFetch } from "@/lib/auth-fetch";
import { getRealtimeClient, destroyRealtimeClient } from "@/lib/supabase-realtime";
import { getModel } from "@/lib/models";

// ── ID Scoping Boundary ──────────────────────────────────────────────
// DB stores scoped IDs: "{userId}:{localId}". The client uses unscoped
// (local) IDs everywhere. GET /api/sessions returns unscoped IDs.
// Realtime delivers scoped IDs (raw DB rows). This boundary converts:
//   - Client → Realtime filter: scopedId() to match DB column values
//   - Realtime → Client state: unscopedId() to match store IDs
function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

function unscopedId(userId: string | null, dbId: string): string {
  if (!userId) return dbId;
  const prefix = `${userId}:`;
  return dbId.startsWith(prefix) ? dbId.slice(prefix.length) : dbId;
}

// Re-use the server session mapping from the old sync hook
function mapServerMessage(m: Record<string, unknown>): ChatMessage {
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
    timestamp: m.timestamp as number,
    pinned: m.pinned as boolean | undefined,
    hidden: m.hidden as boolean | undefined,
    thinking: m.thinking as string | undefined,
    cards: m.cards as import("@/lib/store").ActionCard[] | undefined,
    attachments: m.attachments as import("@/lib/store").Attachment[] | undefined,
    debateTrace: m.debate_trace as import("@/lib/store").DebateTurn[] | undefined,
    dissectorTrace: m.dissector_trace as import("@/lib/store").DissectorTurn[] | undefined,
    simplifierTrace: m.simplifier_trace as import("@/lib/store").SimplifierTurn[] | undefined,
    documents: m.documents as import("@/lib/store").DocumentPreview[] | undefined,
    clarifyingQuestions: m.clarifying_questions as import("@/lib/store").ClarifyingQuestion[] | undefined,
    decisionId: m.decision_id as string | undefined,
    isForkPoint: m.is_fork_point as boolean | undefined,
    forkResolution: m.fork_resolution as "merged" | "closed" | undefined,
    isMergeEnd: m.is_merge_end as boolean | undefined,
  };
}

export function useRealtimeSync() {
  const authenticated = useMeterStore((s) => s.authenticated);
  const userId = useMeterStore((s) => s.userId);
  const activeSessionId = useMeterStore((s) => s.activeSessionId);
  const channelsRef = useRef<{ sessions?: RealtimeChannel; messages?: RealtimeChannel; runs?: RealtimeChannel }>({});
  const prevSessionIdRef = useRef<string | null>(null);

  // ── Bootstrap: fetch sessions from server on mount ──
  useEffect(() => {
    if (!authenticated || !userId) return;
    const uid = userId; // capture for closure

    let cancelled = false;

    async function bootstrap() {
      try {
        const res = await authFetch("/api/sessions");
        if (!res.ok || cancelled) return;
        const data = await res.json();
        if (cancelled) return;

        if (!data.sessions?.length) {
          const store = useMeterStore.getState();
          if (store.sessions.length === 0) {
            useMeterStore.setState({
              sessions: [createSession("default", "My Workspace")],
              activeSessionId: "default",
              sessionsLoaded: true,
            });
          } else {
            useMeterStore.setState({ sessionsLoaded: true });
          }
          return;
        }

        // Build sessions from server data (simplified from old loadSessions merge)
        // Server is source of truth — no merge with localStorage needed
        const serverSessions = data.sessions;
        const sessions = serverSessions.map((s: Record<string, unknown>) => {
          const messages = Array.isArray(s.messages)
            ? (s.messages as Record<string, unknown>[]).map(mapServerMessage)
            : [];
          return {
            id: s.id as string,
            name: (s.workspace_name ?? s.project_name ?? s.name ?? s.id) as string,
            messages,
            isStreaming: false,
            settlementError: null,
            chatBlocked: false,
            todayCost: Number(s.today_cost ?? 0),
            todayTokensIn: Number(s.today_tokens_in ?? 0),
            todayTokensOut: Number(s.today_tokens_out ?? 0),
            todayMessageCount: Number(s.today_message_count ?? 0),
            todayByModel: {},
            todayDate: (s.today_date as string) ?? new Date().toISOString().slice(0, 10),
            weekCost: Number(s.week_cost ?? 0),
            weekKey: s.week_key as string | undefined,
            monthCost: Number(s.month_cost ?? 0),
            monthKey: s.month_key as string | undefined,
            totalCost: Number(s.total_cost ?? 0),
            currentMessageCost: 0,
            connectedServices: {},
            hasOlderMessages: (s.has_more_messages as boolean) ?? false,
            loadingOlderMessages: false,
            oldestLoadedTimestamp: messages.length > 0 ? messages[0].timestamp : null,
            serverTokensIn: Number(s.total_tokens_in ?? 0),
            serverTokensOut: Number(s.total_tokens_out ?? 0),
            serverMessageCount: Number(s.total_message_count ?? 0),
            serverPendingBalance: Number(s.pending_balance ?? 0),
          };
        });

        if (cancelled) return;

        const store = useMeterStore.getState();
        const currentInSessions = sessions.find((s: { id: string }) => s.id === store.activeSessionId);
        const nextActiveId = currentInSessions ? store.activeSessionId : sessions[0]?.id ?? "default";

        useMeterStore.setState({
          sessions,
          activeSessionId: nextActiveId,
          sessionsLoaded: true,
        });

        // Sync workspace store
        useWorkspaceStore.getState().upsertWorkspacesFromSessions(serverSessions, nextActiveId);

        // Check for active streaming runs via the RUNS table (not message receipt_status).
        // Run status is the authority for "is generation alive?"
        // Message receipt_status answers "is content final?" — a different question.
        // GET /api/sessions now includes active_runs per session (see Task 5).
        for (const session of sessions) {
          const activeRuns = (serverSessions.find(
            (ss: Record<string, unknown>) => unscopedId(uid, ss.id as string) === session.id
          ) as Record<string, unknown> | undefined)?.active_runs as unknown[];
          if (Array.isArray(activeRuns) && activeRuns.length > 0) {
            useMeterStore.setState((s) => ({
              sessions: s.sessions.map((sess: { id: string }) =>
                sess.id === session.id ? { ...sess, isStreaming: true } : sess
              ),
            }));
          }
        }

        // Subscribe to Realtime after bootstrap
        await subscribeToRealtime(nextActiveId);

        // ── Reconciliation: close the bootstrap→subscribe gap ──
        // Between bootstrap fetch and subscriptions becoming live, events could
        // have been missed. Do a lightweight re-fetch of the active session's
        // recent messages and merge any new ones.
        try {
          const reconRes = await authFetch("/api/sessions");
          if (reconRes.ok) {
            const reconData = await reconRes.json();
            const reconSession = reconData.sessions?.find(
              (s: Record<string, unknown>) => s.id === nextActiveId
            );
            if (reconSession?.messages?.length) {
              const reconMsgs = (reconSession.messages as Record<string, unknown>[]).map(mapServerMessage);
              useMeterStore.setState((s) => {
                const localSession = s.sessions.find((sess) => sess.id === nextActiveId);
                if (!localSession) return s;
                const localIds = new Set(localSession.messages.map((m) => m.id));
                const newMsgs = reconMsgs.filter((m) => !localIds.has(m.id));
                if (newMsgs.length === 0) return s;
                return {
                  sessions: s.sessions.map((sess) =>
                    sess.id === nextActiveId
                      ? { ...sess, messages: [...sess.messages, ...newMsgs].sort((a, b) => a.timestamp - b.timestamp) }
                      : sess
                  ),
                };
              });
            }
          }
        } catch { /* reconciliation is best-effort */ }

      } catch (err) {
        console.error("[realtime-sync] Bootstrap failed:", err);
        useMeterStore.setState({ sessionsLoaded: true });
      }
    }

    bootstrap();
    useDecisionsStore.getState().fetchDecisions();

    return () => { cancelled = true; };
  }, [authenticated, userId]);

  // ── Subscribe to Realtime channels ──
  const subscribeToRealtime = useCallback(async (sessionId: string) => {
    const uid = useMeterStore.getState().userId;
    if (!uid) return;

    try {
      const client = await getRealtimeClient();

      // DB stores scoped IDs — Realtime filters must match the DB column values
      const dbSessionId = scopedId(uid, sessionId);

      // 1. Subscribe to chat_sessions (all user's sessions — RLS filters by user)
      channelsRef.current.sessions = client
        .channel("sessions")
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "chat_sessions",
        }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          handleSessionChange(payload, uid);
        })
        .subscribe();

      // 2. Subscribe to chat_messages for active session (scoped filter)
      channelsRef.current.messages = client
        .channel(`messages-${sessionId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "chat_messages",
          filter: `session_id=eq.${dbSessionId}`,
        }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          handleMessageChange(payload, sessionId, uid);
        })
        .subscribe();

      // 3. Subscribe to chat_runs for active session (scoped filter)
      channelsRef.current.runs = client
        .channel(`runs-${sessionId}`)
        .on("postgres_changes", {
          event: "*",
          schema: "public",
          table: "chat_runs",
          filter: `session_id=eq.${dbSessionId}`,
        }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
          handleRunChange(payload, sessionId);
        })
        .subscribe();

    } catch (err) {
      console.error("[realtime-sync] Subscription failed:", err);
    }
  }, []);

  // ── Handle session switching: resubscribe to new session's channels ──
  useEffect(() => {
    if (!authenticated || !activeSessionId) return;
    if (prevSessionIdRef.current === activeSessionId) return;
    prevSessionIdRef.current = activeSessionId;

    // Unsubscribe from old session's message/run channels
    if (channelsRef.current.messages) {
      channelsRef.current.messages.unsubscribe();
      channelsRef.current.messages = undefined;
    }
    if (channelsRef.current.runs) {
      channelsRef.current.runs.unsubscribe();
      channelsRef.current.runs = undefined;
    }

    // Subscribe to new session (only messages + runs; sessions channel is global)
    (async () => {
      const uid = useMeterStore.getState().userId;
      if (!uid) return;

      try {
        const client = await getRealtimeClient();
        const dbSessionId = scopedId(uid, activeSessionId);

        channelsRef.current.messages = client
          .channel(`messages-${activeSessionId}`)
          .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "chat_messages",
            filter: `session_id=eq.${dbSessionId}`,
          }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            handleMessageChange(payload, activeSessionId, uid);
          })
          .subscribe();

        channelsRef.current.runs = client
          .channel(`runs-${activeSessionId}`)
          .on("postgres_changes", {
            event: "*",
            schema: "public",
            table: "chat_runs",
            filter: `session_id=eq.${dbSessionId}`,
          }, (payload: RealtimePostgresChangesPayload<Record<string, unknown>>) => {
            handleRunChange(payload, activeSessionId);
          })
          .subscribe();
      } catch (err) {
        console.error("[realtime-sync] Resubscribe failed:", err);
      }
    })();
  }, [authenticated, activeSessionId]);

  // ── Cleanup on unmount ──
  useEffect(() => {
    return () => {
      Object.values(channelsRef.current).forEach((ch) => ch?.unsubscribe());
      channelsRef.current = {};
    };
  }, []);
}

// ── Realtime event handlers ──

function handleSessionChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  uid: string,
) {
  const { eventType, new: newRow } = payload;
  if (!newRow || typeof newRow !== "object") return;

  // Realtime delivers raw DB rows with scoped IDs — unscope for client state
  const sessionId = unscopedId(uid, newRow.id as string);

  if (eventType === "UPDATE") {
    // Update session metadata (cost counters, name, etc.)
    useMeterStore.setState((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        return {
          ...sess,
          name: (newRow.workspace_name as string) ?? sess.name,
          totalCost: Number(newRow.total_cost ?? sess.totalCost),
          todayCost: Number(newRow.today_cost ?? sess.todayCost),
          todayTokensIn: Number(newRow.today_tokens_in ?? sess.todayTokensIn),
          todayTokensOut: Number(newRow.today_tokens_out ?? sess.todayTokensOut),
          todayMessageCount: Number(newRow.today_message_count ?? sess.todayMessageCount),
        };
      }),
    }));
  }

  if (eventType === "INSERT") {
    // New workspace created on another device
    const store = useMeterStore.getState();
    if (!store.sessions.find((s) => s.id === sessionId)) {
      const newSession = createSession(
        sessionId,
        (newRow.workspace_name as string) ?? (newRow.project_name as string) ?? sessionId,
      );
      useMeterStore.setState((s) => ({
        sessions: [...s.sessions, newSession],
      }));
    }
  }
}

function handleMessageChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  sessionId: string,
  uid: string,
) {
  const { eventType, new: newRow } = payload;
  if (!newRow || typeof newRow !== "object") return;

  // Message IDs are UUIDs (not scoped), but session_id in the payload is scoped.
  // The sessionId parameter is already unscoped (passed from the subscription setup).
  const msgId = newRow.id as string;

  if (eventType === "INSERT") {
    // New message — deduplicate against existing (optimistic or already loaded)
    const store = useMeterStore.getState();
    const session = store.sessions.find((s) => s.id === sessionId);
    if (!session) return;
    if (session.messages.find((m) => m.id === msgId)) return; // already have it

    const mapped = mapServerMessage(newRow);
    useMeterStore.setState((s) => ({
      sessions: s.sessions.map((sess) =>
        sess.id === sessionId
          ? { ...sess, messages: [...sess.messages, mapped].sort((a, b) => a.timestamp - b.timestamp) }
          : sess
      ),
    }));
  }

  if (eventType === "UPDATE") {
    // Content update (streaming) or finalization (metered + cost).
    //
    // MONOTONIC MERGE RULE: The sending device receives updates via both
    // direct SSE (fast) and Realtime (slightly delayed). Without a
    // freshness check, a stale Realtime UPDATE could overwrite newer SSE
    // state. Rules:
    //   1. For content: only apply if incoming length >= current length
    //      (content only grows during streaming)
    //   2. For status fields: only apply if incoming is "more advanced"
    //      (metering < metered < settled)
    //   3. For cost/tokens: only apply if incoming is non-null and current is null,
    //      or if receipt_status is advancing
    const receiptRank = (s?: string) =>
      s === "settled" ? 3 : s === "metered" ? 2 : s === "metering" ? 1 : 0;

    useMeterStore.setState((s) => ({
      sessions: s.sessions.map((sess) => {
        if (sess.id !== sessionId) return sess;
        const msgs = sess.messages.map((m) => {
          if (m.id !== msgId) return m;

          const incomingContent = (newRow.content as string) ?? "";
          const incomingStatus = newRow.receipt_status as ReceiptStatus | undefined;
          const statusAdvancing = receiptRank(incomingStatus) > receiptRank(m.receiptStatus);

          return {
            ...m,
            // Content: only accept if longer (monotonic growth during streaming)
            content: incomingContent.length >= (m.content?.length ?? 0)
              ? incomingContent : m.content,
            // Status: only advance, never regress
            receiptStatus: statusAdvancing ? incomingStatus : m.receiptStatus,
            // Cost/tokens: only accept on status advance or if currently missing
            cost: (statusAdvancing || m.cost == null) ? ((newRow.cost as number) ?? m.cost) : m.cost,
            tokensIn: (statusAdvancing || m.tokensIn == null) ? ((newRow.tokens_in as number) ?? m.tokensIn) : m.tokensIn,
            tokensOut: (statusAdvancing || m.tokensOut == null) ? ((newRow.tokens_out as number) ?? m.tokensOut) : m.tokensOut,
            thinking: (newRow.thinking as string) ?? m.thinking,
          };
        });
        return { ...sess, messages: msgs };
      }),
    }));
  }
}

function handleRunChange(
  payload: RealtimePostgresChangesPayload<Record<string, unknown>>,
  sessionId: string,
) {
  const { eventType, new: newRow } = payload;
  if (!newRow || typeof newRow !== "object") return;

  const status = newRow.status as string;

  if (eventType === "INSERT" || eventType === "UPDATE") {
    // Run started or status changed
    const isActive = status === "created" || status === "streaming";
    const isTerminal = status === "complete" || status === "failed" || status === "timed_out";

    if (isActive) {
      // Show streaming indicator
      useMeterStore.setState((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, isStreaming: true } : sess
        ),
      }));
    }

    if (isTerminal) {
      // Stop streaming indicator
      useMeterStore.setState((s) => ({
        sessions: s.sessions.map((sess) =>
          sess.id === sessionId ? { ...sess, isStreaming: false } : sess
        ),
      }));
    }
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/use-realtime-sync.ts
git commit -m "feat: add useRealtimeSync hook with bootstrap + three Realtime channels"
```

---

## Task 3: Wire up `useRealtimeSync` in the app

**Files:**
- Modify: the component that currently calls `useSessionSync()`

Search for `useSessionSync()` in the codebase to find where it's mounted. It's likely in a top-level layout or app shell component.

- [ ] **Step 1: Find and replace the hook call**

Replace the `useSessionSync()` call with `useRealtimeSync()`. Keep the import of `useSessionSync` commented out (not deleted) so it can be restored if needed during PR4 testing.

```typescript
// import { useSessionSync } from "@/lib/use-session-sync";
import { useRealtimeSync } from "@/lib/use-realtime-sync";

// In the component body:
// useSessionSync();  // disabled — replaced by Realtime
useRealtimeSync();
```

- [ ] **Step 2: Commit**

```bash
git add -A
git commit -m "feat: replace useSessionSync with useRealtimeSync in app shell"
```

---

## Task 4: Shrink `partialize` to UI preferences only

**Files:**
- Modify: `src/lib/store.ts` (around line 1855)

- [ ] **Step 1: Update partialize to stop persisting messages and sessions**

Replace the current `partialize` (lines 1855-1883) with:

```typescript
      partialize: (s) => ({
        // Auth state (needed for fast page load before server fetch)
        userId: s.userId,
        email: s.email,
        handle: s.handle,
        accountType: s.accountType,
        authenticated: s.authenticated,
        // UI preferences
        selectedModelId: s.selectedModelId,
        debateMode: s.debateMode,
        debateRoster: s.debateRoster,
        spendingCapEnabled: s.spendingCapEnabled,
        spendingCap: s.spendingCap,
        autoSettleThreshold: s.autoSettleThreshold,
        lastAutoSettleDate: s.lastAutoSettleDate,
        // Active session ID (so the user returns to the same workspace)
        activeSessionId: s.activeSessionId,
        spendLimits: s.spendLimits,
        // NOTE: sessions, messages, and cost counters are NO LONGER persisted.
        // The server is the source of truth. Bootstrap fetch loads them.
      }),
```

This removes `sessions` (with messages), `markupMultiplier`, `cardOnFile`, `cardLast4`, `cardBrand`, `stripeCustomerId`, `creditBalance` from localStorage. These are now loaded from the server on each page load.

- [ ] **Step 2: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: shrink partialize to UI prefs only — server is source of truth"
```

---

## Task 5: Add active runs to GET /api/sessions bootstrap response

**Files:**
- Modify: `src/app/api/sessions/route.ts`

The bootstrap needs to know which sessions have active streaming runs so the UI can show the streaming indicator immediately. Without this, the client falls back to a heuristic (`receipt_status === "metering"`) that conflates "is generation alive?" with "is content final?" — the exact coupling the spec aims to eliminate.

- [ ] **Step 1: Fetch active runs per session in the bootstrap query**

In `src/app/api/sessions/route.ts`, inside the `Promise.all` per-session block (after the messages and stats queries), add a third parallel query for active runs:

```typescript
        // Fetch active runs (streaming or created) for this session
        supabase
          .from("chat_runs")
          .select("id, status, assistant_message_id, last_chunk_at")
          .eq("session_id", session.id)
          .in("status", ["created", "streaming"])
          .is("finalized_at", null),
```

- [ ] **Step 2: Include active_runs in the response**

In the result mapping, add the active runs to each session:

```typescript
        active_runs: (activeRunsBySession[s.id] ?? []).map((r) => ({
          id: r.id,
          status: r.status,
          assistant_message_id: r.assistant_message_id,
          last_chunk_at: r.last_chunk_at,
        })),
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/sessions/route.ts
git commit -m "feat: include active_runs in GET /api/sessions for authoritative stream liveness"
```

---

## Verification Checklist — Invariants

- [ ] **Sender and second device convergence:** Send a message on device A. Device B sees the user message AND streaming assistant content appear within 2 seconds via Realtime. Final cost appears on both devices when stream completes.
- [ ] **No data loss on refresh (stream active):** Send a message, refresh mid-stream. Page loads with partial content from bootstrap. Content continues growing via Realtime UPDATEs. Final message has full content + cost.
- [ ] **No data loss on refresh (stream completed):** Send a message, wait for completion, refresh. Page loads with full content + cost from bootstrap. No streaming indicator.
- [ ] **Correct timeout behavior:** Simulate a dead stream (send message, kill the server function manually or wait for cron). Verify: run status becomes `timed_out` via Realtime. UI shows "Response interrupted." Message `receipt_status` remains `metering` (NOT force-marked `metered`). Cost is unknown (NULL), not fake $0.
- [ ] **Monotonic merge:** During streaming, the sending tab has content from SSE. A Realtime UPDATE arrives with shorter content (delayed). Verify: the shorter content does NOT overwrite the longer SSE content.
- [ ] **No data loss on logout:** Logout. Login. All messages from all sessions are present (loaded from server bootstrap). localStorage contains only UI preferences.
- [ ] **Session switching isolation:** Switch from workspace A to workspace B. Verify: Realtime events for workspace A no longer arrive. Events for workspace B start arriving.
- [ ] **Scoped ID boundary is consistent:** Enable Realtime logging in the browser console. Subscribe to a session. Verify: Realtime filter uses scoped DB ID (`userId:sessionId`). Incoming events' `newRow.id` is unscoped before matching against store. No events are silently dropped due to ID mismatch.
- [ ] **Bootstrap→subscribe gap is closed:** Send a message immediately before a page refresh (timing matters). After refresh, verify the message appears — either from bootstrap or from the reconciliation fetch. No messages are lost in the gap.
- [ ] **Stream liveness from runs, not receipt_status:** Refresh while a stream is active. Verify: the streaming indicator appears because `active_runs` in the bootstrap response contains the running run — NOT because `receipt_status === "metering"`.
