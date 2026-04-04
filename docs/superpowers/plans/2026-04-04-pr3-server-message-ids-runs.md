# PR3: Server Mints Message IDs + Durable Runs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move message creation and run lifecycle to the server. The `/api/chat` route creates message rows via the `create_run` RPC before streaming, sends canonical IDs in an SSE preamble, and finalizes atomically via `finalize_run`. The client uses optimistic temp IDs that are swapped on preamble receipt. A cron watchdog reaps stale streaming runs.

**Architecture:** The chat route calls the `create_run` Postgres RPC (from PR1) which atomically creates a run + user message + assistant message in one transaction. It returns canonical IDs sent to the client as an SSE preamble event. The client swaps its temp IDs. On stream completion, the route calls `finalize_run` RPC for exactly-once cost counter updates. A cron job marks stale runs as `timed_out`.

**Tech Stack:** Next.js 15 API routes, Supabase RPC, SSE streaming, Zustand store, Vercel cron.

**Spec:** `docs/superpowers/specs/2026-04-04-server-authoritative-state-design.md` — Section 3

**Depends on:** PR1 (schema + RPCs) and PR2 (server workspace IDs) must be deployed first.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/chat/route.ts` | Modify | Call `create_run` RPC, emit SSE preamble, partial saves with `updated_at`/`last_chunk_at`, call `finalize_run`, set `failed` on cancel |
| `src/components/chat-view.tsx` | Modify | Generate `clientRequestId`, use temp IDs, swap on SSE preamble, stop sending `userMessageId`/`assistantMessageId` |
| `src/lib/store.ts` | Modify | Add `replaceMessageId` action for temp→canonical swap |
| `src/app/api/cron/reap-stale-runs/route.ts` | Create | Cron watchdog: mark stale runs as `timed_out` |
| `vercel.json` | Modify | Add cron schedule for reap-stale-runs |

---

## Task 1: Add `replaceMessageId` action to store

**Files:**
- Modify: `src/lib/store.ts`

- [ ] **Step 1: Add the replaceMessageId action**

Add to the MeterState interface (around line 276, after `removeLastMessage`):

```typescript
  replaceMessageId: (oldId: string, newId: string, forSessionId?: string) => void;
```

Add the implementation (after the `removeLastMessage` implementation):

```typescript
      replaceMessageId: (oldId, newId, forSessionId?) =>
        set((s) => {
          const active = getSessionByIdOrActive(s, forSessionId);
          const msgs = active.messages.map((m) =>
            m.id === oldId ? { ...m, id: newId } : m
          );
          const updated = { ...active, messages: msgs };
          return { sessions: replaceActiveSession(s, updated) };
        }),
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: add replaceMessageId store action for temp→canonical ID swap"
```

---

## Task 2: Modify `/api/chat` to create run + messages server-side

**Files:**
- Modify: `src/app/api/chat/route.ts`

This is the largest change. The route currently receives `userMessageId` and `assistantMessageId` from the client. We change it to:
1. Accept `clientRequestId` instead
2. Call `create_run` RPC to get server-minted IDs
3. Send an SSE preamble event with the canonical IDs
4. Use the server-minted `assistantMessageId` for all partial saves
5. Call `finalize_run` RPC instead of inline cost updates

- [ ] **Step 1: Update request body parsing**

In `src/app/api/chat/route.ts`, around line 48, change:

```typescript
  const { messages, model, connectedServices, attachments, debateRoster, userMessageId, assistantMessageId } = body;
```

To:

```typescript
  const { messages, model, connectedServices, attachments, debateRoster, clientRequestId } = body;
  // Legacy: still accept userMessageId/assistantMessageId for backwards compatibility during rollout
  let userMessageId: string | undefined = body.userMessageId;
  let assistantMessageId: string | undefined = body.assistantMessageId;
```

- [ ] **Step 2: Add run creation before streaming**

After the session row upsert block (around line 285, after the `(async () => { ... })()` block), add:

```typescript
    // ── Server-minted IDs via create_run RPC ──────────────────────
    // If clientRequestId is provided (new flow), create the run + messages
    // server-side. This is atomic and idempotent (retries reuse the same run).
    let runId: string | undefined;
    if (clientRequestId && projectId) {
      const supabaseRun = getSupabaseServer();
      const dbSessionId = projectId.startsWith(`${userId}:`) ? projectId : `${userId}:${projectId}`;
      const userContent = messages[messages.length - 1]?.content ?? "";

      const { data: runData, error: runErr } = await supabaseRun.rpc("create_run", {
        p_session_id: dbSessionId,
        p_client_request_id: clientRequestId,
        p_model: model ?? "auto",
        p_user_content: typeof userContent === "string" ? userContent : JSON.stringify(userContent),
      });

      if (runErr) {
        console.error("[/api/chat] create_run failed:", runErr);
        return new Response(
          JSON.stringify({ error: "Failed to create run" }),
          { status: 500, headers: { "Content-Type": "application/json" } },
        );
      }

      const run = Array.isArray(runData) ? runData[0] : runData;
      if (run) {
        runId = run.run_id;
        userMessageId = run.user_message_id;
        assistantMessageId = run.assistant_message_id;

        // If run is already terminal (retry of finished request), return immediately
        if (run.run_status === "complete" || run.run_status === "failed" || run.run_status === "timed_out") {
          return new Response(
            JSON.stringify({ error: `Run already ${run.run_status}`, runId, userMessageId, assistantMessageId }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }

        // If run is already streaming from another request, don't start a duplicate
        // model call. create_run returns is_new=false when the run was already fully
        // built (messages existed). Without this guard, a retry with the same
        // clientRequestId would reuse the same run but start a SECOND upstream model
        // call — conflicting content writes and double billing.
        // The client should pick up the streaming content via Realtime instead.
        if (run.run_status === "streaming" && run.is_new === false) {
          return new Response(
            JSON.stringify({
              error: "Run already streaming elsewhere",
              runId, userMessageId, assistantMessageId,
            }),
            { status: 409, headers: { "Content-Type": "application/json" } },
          );
        }
      }
    }
```

- [ ] **Step 3: Emit SSE preamble with canonical IDs**

In the ReadableStream's `start()` handler (around line 358), before the streaming loop begins, add at the top:

```typescript
        // Send canonical IDs so the client can swap its temp IDs
        if (runId && userMessageId && assistantMessageId) {
          const preamble = { type: "ids", runId, userMessageId, assistantMessageId };
          try {
            controller.enqueue(encoder.encode(`data: ${JSON.stringify(preamble)}\n\n`));
          } catch { /* client closed */ }
        }
```

- [ ] **Step 4: Update partial saves to use `updated_at` and `last_chunk_at`**

In the periodic partial save block (around line 369), update the `saveMessageToDB` call to include `updated_at`. Also add a `chat_runs` last_chunk_at update:

After the existing `saveMessageToDB` call for partial content, add:

```typescript
              // Update run's last_chunk_at for dead stream detection
              if (runId) {
                const supabaseChunk = getSupabaseServer();
                supabaseChunk.from("chat_runs")
                  .update({ last_chunk_at: new Date().toISOString() })
                  .eq("id", runId)
                  .then(() => {})
                  .catch(() => {});
              }
```

- [ ] **Step 5: Replace final save with `finalize_run` RPC call**

Replace the final save block (lines 815-831) with:

```typescript
        if (assistantMessageId && projectId) {
          // Save content to message row (finalize_run handles status/cost/counters)
          await saveMessageToDB({
            id: assistantMessageId,
            sessionId: projectId,
            role: "assistant",
            content: fullAssistantContent,
            model: activeModel,
            tokensIn: cumulativeTokensIn || undefined,
            tokensOut: cumulativeTokensOut || undefined,
            cacheCreationTokens: cumulativeCacheCreation || undefined,
            cacheReadTokens: cumulativeCacheRead || undefined,
            cacheReadRate: roundCacheReadRate || undefined,
            receiptStatus: "metered",
            timestamp: Date.now(),
            thinking: fullThinkingContent || undefined,
            documents: serverDocuments.length > 0 ? serverDocuments : undefined,
          });

          // Exactly-once finalization via RPC (if using new run flow)
          if (runId) {
            try {
              const supabaseFinalize = getSupabaseServer();
              // Compute cost server-side (same logic as saveMessageToDB)
              let cost = 0;
              try {
                const modelInfo = getModel(activeModel);
                const cacheWrite = cumulativeCacheCreation ?? 0;
                const cacheHit = cumulativeCacheRead ?? 0;
                const readRate = roundCacheReadRate || 0.1;
                const uncachedIn = (cumulativeTokensIn ?? 0) - cacheWrite - cacheHit;
                const inputCost = (cacheWrite > 0 || cacheHit > 0)
                  ? (uncachedIn * modelInfo.inputPrice) +
                    (cacheWrite * modelInfo.inputPrice * 1.25) +
                    (cacheHit * modelInfo.inputPrice * readRate)
                  : (cumulativeTokensIn ?? 0) * modelInfo.inputPrice;
                cost = (inputCost + (cumulativeTokensOut ?? 0) * modelInfo.outputPrice) * markupMultiplier;
              } catch { /* unknown model */ }

              await supabaseFinalize.rpc("finalize_run", {
                p_run_id: runId,
                p_cost: cost,
                p_tokens_in: cumulativeTokensIn ?? 0,
                p_tokens_out: cumulativeTokensOut ?? 0,
                p_cache_creation_tokens: cumulativeCacheCreation ?? null,
                p_cache_read_tokens: cumulativeCacheRead ?? null,
              });
            } catch (err) {
              console.warn("[/api/chat] finalize_run failed:", err);
            }
          }
        }
```

- [ ] **Step 6: Update cancel() to set run status to 'failed'**

In the `cancel()` handler (around line 837), add after the existing `saveMessageToDB` call:

```typescript
          // Mark the run as failed so the cron watchdog doesn't also reap it
          if (runId) {
            const supabaseCancel = getSupabaseServer();
            supabaseCancel.from("chat_runs")
              .update({ status: "failed" })
              .eq("id", runId)
              .then(() => {})
              .catch(() => {});
          }
```

- [ ] **Step 7: Commit**

```bash
git add src/app/api/chat/route.ts
git commit -m "feat: /api/chat creates runs server-side, emits SSE preamble, calls finalize_run"
```

---

## Task 3: Update `chat-view.tsx` for optimistic updates + ID swap

**Files:**
- Modify: `src/components/chat-view.tsx`

- [ ] **Step 1: Generate clientRequestId and use temp IDs**

In the `streamResponse` function (around line 1785), update the message creation block.

Replace the ID generation (around lines 1809-1835):

```typescript
      // Old: const userMsg = { id: Math.random().toString(36).slice(2, 10), ... }
      // New: use temp IDs that will be swapped when the server responds
      const tempUserMsgId = `pending_${crypto.randomUUID()}`;
      const tempAssistantMsgId = `pending_${crypto.randomUUID()}`;
      const clientRequestId = `req_${crypto.randomUUID()}`;
```

Update the userMsg and assistantMsg objects to use `tempUserMsgId` and `tempAssistantMsgId`.

- [ ] **Step 2: Update the POST /api/chat body**

In the fetch call (around line 1891), replace `userMessageId` and `assistantMessageId` with `clientRequestId`:

```typescript
      body: JSON.stringify({
        messages: allMessages,
        model: effectiveModel,
        sessionId: streamSessionId,
        clientRequestId,
        markupMultiplier,
        connectedServices: Object.keys(connectedServices).filter(k => connectedServices[k]),
        ...(userAttachments?.length ? { attachments: userAttachments } : {}),
        ...(effectiveModel === "debate" ? { debateRoster: useMeterStore.getState().debateRoster } : {}),
      }),
```

- [ ] **Step 3: Handle SSE preamble event for ID swap**

In the SSE parsing loop (around line 1995), add handling for the `ids` event type:

```typescript
              if (parsed.type === "ids") {
                // Server sent canonical IDs — swap temp IDs
                const { runId: serverRunId, userMessageId: serverUserMsgId, assistantMessageId: serverAssistantMsgId } = parsed;
                if (serverUserMsgId) {
                  replaceMessageId(tempUserMsgId, serverUserMsgId, streamSessionId);
                }
                if (serverAssistantMsgId) {
                  replaceMessageId(tempAssistantMsgId, serverAssistantMsgId, streamSessionId);
                  // Update local reference so subsequent updateLastAssistantMessage calls target the right message
                  // (The store's updateLastAssistantMessage works on the last assistant message, so this is automatic)
                }
                continue;
              }
```

Make sure `replaceMessageId` is imported from the store at the top of the component (alongside other store selectors).

- [ ] **Step 4: Commit**

```bash
git add src/components/chat-view.tsx
git commit -m "feat: chat-view uses temp IDs + clientRequestId, swaps on SSE preamble"
```

---

## Task 4: Create cron watchdog for stale runs

**Files:**
- Create: `src/app/api/cron/reap-stale-runs/route.ts`
- Modify: `vercel.json`

- [ ] **Step 1: Create the cron endpoint**

```typescript
// src/app/api/cron/reap-stale-runs/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";

// Vercel cron calls this every minute. Marks stale streaming runs as timed_out.
// The 5-minute threshold matches maxDuration=300 in the chat route.
export async function GET(req: NextRequest) {
  // Verify cron secret to prevent unauthorized calls
  const authHeader = req.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
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
```

- [ ] **Step 2: Add cron schedule to vercel.json**

In `vercel.json`, add to the `crons` array:

```json
    {
      "path": "/api/cron/reap-stale-runs",
      "schedule": "* * * * *"
    }
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/cron/reap-stale-runs/route.ts vercel.json
git commit -m "feat: add cron watchdog to reap stale streaming runs"
```

---

## Verification Checklist — Invariants

- [ ] **One assistant row per user turn:** Send a message. Verify exactly one `chat_messages` row with `role='assistant'` and the run's `assistant_message_id`. Retry the same `clientRequestId` via curl — verify NO new rows are created, same IDs returned.
- [ ] **No duplicate model execution:** While a message is still streaming, send a second request with the same `clientRequestId`. Verify: the second request returns 409 with `"Run already streaming elsewhere"`. Only one upstream model call exists. No conflicting content writes.
- [ ] **Exactly-once finalization:** After stream completes, check `chat_runs.finalized_at` is set. Call `finalize_run` RPC again with the same `run_id` — verify it returns `false` and `chat_sessions` cost counters are NOT incremented a second time.
- [ ] **Run liveness is separate from message completeness:** After the cron reaps a stale run, verify `chat_runs.status = 'timed_out'` but `chat_messages.receipt_status` is still `'metering'` (NOT force-marked as `'metered'`). The message has partial content — it is not "done."
- [ ] **No data loss on refresh:** Send a message, refresh mid-stream. Verify the assistant message exists in DB with partial content and `receipt_status = 'metering'`. The run has `status = 'streaming'` and `last_chunk_at` is recent.
- [ ] **Backwards compatible:** Send a message without `clientRequestId` (old flow). Verify the old `userMessageId`/`assistantMessageId` path still works, no run is created, and the message completes normally.
