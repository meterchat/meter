# Server-Authoritative State for Meter

**Date:** 2026-04-04
**Status:** Draft
**Author:** Claude + Osama

## Problem Statement

Since commit `2248e42` ("Fix last AI message disappearing on page refresh"), Meter has accumulated ~50 commits attempting to fix three persistent issues:

1. **Message loss on logout** — signing out wipes localStorage before sync completes, losing hundreds of messages that never reached the DB
2. **Broken stream resume on refresh** — refreshing mid-stream stops the response, wipes content, or shows $0 cost with 0 meter counter
3. **Split chat histories across devices** — phone and desktop create separate workspace session IDs, producing two divergent histories for the same workspace

### Root Cause

All three issues stem from a single architectural problem: **the client is the source of truth for identity and state**.

- Session IDs are generated client-side (`ws_${Math.random()}`) in `workspace-store.ts:72`
- Message IDs are generated client-side in `chat-view.tsx`
- Messages live in localStorage first, synced to the DB later via a periodic timer + sendBeacon
- Stream resume uses a custom polling endpoint (`/api/chat/resume`) that guesses whether a stream is dead
- Logout must race a 3-second timeout to sync before clearing localStorage

The ~940 lines of sync infrastructure (`useSessionSync`, delta tracking, snapshot hashing, sendBeacon handlers, reconnect logic) exist to paper over this fundamental mismatch. Each fix attempt has added complexity without addressing the root cause.

## Objectives

1. **Refreshes during streaming recover gracefully** — the UI picks up from where it left off with zero text loss, and completed messages show full content with accurate cost
2. **Meter works seamlessly across multiple devices** — messages sent on phone appear on desktop within seconds, with one shared history per workspace
3. **No data loss on logout** — everything is already in the DB before the user logs out; logout is just cache clearing
4. **Net reduction in code complexity** — delete ~940 lines of sync infrastructure, add ~290 lines of server endpoints and Realtime subscriptions

## Design Principles

- **Server writes first, clients react.** No "sync later" window where data exists only locally.
- **One mechanism for everything.** Supabase Realtime handles cross-device sync, stream resume, and workspace metadata updates. No special-purpose endpoints.
- **Optimistic updates for speed.** The sending device shows messages instantly. Server confirmation arrives within milliseconds. Other devices see messages via Realtime.
- **localStorage is a disposable cache.** It holds drafts and UI preferences. Deleting it loses nothing important.

## Non-Goals

- Offline message support (the AI can't respond offline anyway)
- Capacitor/native mobile app support (focusing on mobile web + desktop web)
- Real-time collaborative editing (one user sends at a time per workspace)

---

## Architecture Overview

### Current Flow (What's Broken)

```
SENDING DEVICE                          SERVER                         OTHER DEVICE
------                                  ------                         ------
User types message
  -> addMessage() to Zustand store
  -> localStorage updated immediately
  -> POST /api/chat (SSE stream)
  -> chunks arrive, update store
  -> finalizeResponse()
  -> store updated, localStorage updated
  ...
  (10s timer fires)
  -> syncToServer() POST /api/sessions    -> upsert to DB
    with delta messages                                                (knows nothing)

  (other device refreshes)                                            -> GET /api/sessions
                                                                      -> merge local + server
                                                                      -> maybe see messages,
                                                                        maybe not
```

### New Flow

```
SENDING DEVICE                          SERVER                         OTHER DEVICE
------                                  ------                         ------
User types message
  -> OPTIMISTIC: add to Zustand
     (temp ID, instant UI)
  -> POST /api/chat
     { sessionId, content, model,        -> INSERT chat_runs row
       clientRequestId }                    (status: "streaming",
                                             UNIQUE client_request_id)
                                         -> INSERT user msg (server ID)
                                         -> INSERT assistant msg         --> Realtime INSERT
                                            (server ID)                  --> Realtime INSERT
     <- SSE preamble: { runId,                                           --> Realtime INSERT
        userMsgId, assistantMsgId }                                         (chat_runs)
     (swap temp ID for canonical)
     <- SSE content chunks (fast path)   -> UPDATE msg every ~2s         --> Realtime UPDATE
                                            (content, updated_at)           (content streams in)
                                         -> UPDATE run last_chunk_at     --> Realtime UPDATE
     <- SSE done + usage                 -> FINALIZE (atomic):           --> Realtime UPDATE
                                            UPDATE run: complete,           (run complete + cost)
                                              cost, tokens,              --> Realtime UPDATE
                                              finalized_at = now            (session counters)
                                            UPDATE session: counters
                                            (finalized_at IS NULL
                                             guard = exactly once)

ON REFRESH (mid-stream):
  -> GET /api/sessions (bootstrap)
     renders partial content instantly
  -> Subscribe to Realtime (runs, msgs, sessions)
  -> Reconciliation fetch (close gap)
  -> Realtime UPDATEs arrive as
     server continues saving
  -> run status: "streaming" ->
     "complete" tells client when done
  -> If run stays "streaming" with
     stale last_chunk_at:
     cron watchdog marks "timed_out"
     -> Realtime delivers terminal state

LOGOUT:
  -> Unsubscribe from Realtime
  -> Clear Zustand store
  -> Clear localStorage preferences
  -> Done. Everything is already in DB.
```

---

## Detailed Design

### 1. Realtime Auth Bridge

**Problem:** Supabase Realtime requires JWT-based authorization. This app uses cookie-based auth (`meter_session` cookie validated against `auth_sessions` table). The browser Supabase client is never instantiated — all queries go through API routes with the service-role key. RLS policies exist in `setup-db/route.ts` but `setRLSContext()` is dead code.

**Solution:**

A new authenticated endpoint `GET /api/realtime/token` mints a short-lived JWT containing the user's ID. The browser uses this JWT to authenticate with Supabase Realtime.

```
Browser                     Server                      Supabase
------                      ------                      --------
GET /api/realtime/token
  (with meter_session cookie)
                            -> requireAuth() validates cookie
                            -> mint JWT { sub: userId, exp: +1h }
                            <- { token: "eyJ..." }

createClient(url, anonKey)
client.realtime.setAuth(token)
client.channel("user-messages")
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "chat_messages",
    filter: `session_id=eq.${sessionId}`
  })
  .subscribe()
                                                        -> RLS policy checks
                                                           JWT sub against
                                                           chat_sessions.user_id
                                                        -> Only delivers rows
                                                           owned by this user
```

**JWT spec:**
- Algorithm: HS256 signed with `SUPABASE_JWT_SECRET`
- Payload: `{ sub: userId, role: "authenticated", exp: now + 3600 }`
- Client refreshes token every 50 minutes (before expiry)

**RLS policy additions (additive, alongside existing service-role queries):**
- `chat_messages`: SELECT where `session_id` belongs to a `chat_sessions` row with matching `user_id` from JWT
- `chat_sessions`: SELECT where `user_id` matches JWT sub

**Publication setup:**
- Add `chat_sessions` and `chat_messages` to the `supabase_realtime` publication
- Added in `setup-db/route.ts` as additive DDL

### 2. Server-Minted Workspace IDs

**Problem:** `workspace-store.ts:72` generates `ws_${Math.random()}` session IDs. Two devices create the same workspace with different IDs, producing split histories.

**Solution:** New endpoint creates workspaces server-side.

```
POST /api/workspaces
  Body: { name: "fibor" }
  Response: { sessionId: "abc123", name: "fibor" }

  Server:
    -> INSERT into chat_sessions {
         id: scopedId(userId, generatedId),
         user_id: userId,
         workspace_name: name,
         created_at: now
       }
    -> Return unscoped ID to client

PATCH /api/workspaces/:id
  Body: { name?, archived?, committed? }
  -> UPDATE chat_sessions row
  -> Realtime delivers UPDATE to all subscribed clients

DELETE /api/workspaces/:id
  -> Soft-delete (set deleted_at)
  -> Realtime delivers UPDATE to all subscribed clients
```

**Client changes:**
- `workspace-store.ts:createWorkspace` becomes async: calls `POST /api/workspaces`, receives canonical `sessionId`
- The workspace store shrinks to UI state only: `activeWorkspaceId`, `activeTrackId`
- The workspace *list* comes from the `chat_sessions` Realtime subscription

**Migration:** No schema changes needed. Existing `ws_*` IDs in the DB continue to work. The fix is that new workspaces get server-minted IDs, so all devices share the same one.

### 3. Server-Minted Message IDs, Durable Runs, and Exactly-Once Finalization

**Problem:** `chat-view.tsx` generates message IDs client-side. If a request is retried (network flake), duplicate messages can be created. The server has no ownership of the "run" — it just streams into whatever IDs the client invented. There is no guard against double-applying cost counters on retries, and abrupt serverless termination can leave messages in a fake-metered state with $0 cost.

**Solution:** A new `chat_runs` table tracks request lifecycle, enforces idempotency via DB constraint, and guarantees exactly-once finalization. `/api/chat` creates a run and message rows before streaming starts.

#### New schema: `chat_runs` table

```sql
chat_runs (
  id                   UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id           TEXT NOT NULL REFERENCES chat_sessions(id),
  client_request_id    TEXT,
  user_message_id      UUID,
  assistant_message_id UUID,
  status               TEXT NOT NULL DEFAULT 'created',
    -- 'created' | 'streaming' | 'complete' | 'failed' | 'timed_out'
  model                TEXT,
  cost                 NUMERIC,
  tokens_in            INTEGER,
  tokens_out           INTEGER,
  cache_creation_tokens INTEGER,
  cache_read_tokens    INTEGER,
  last_chunk_at        TIMESTAMPTZ,
  finalized_at         TIMESTAMPTZ,  -- NULL until exactly-once finalization
  created_at           TIMESTAMPTZ DEFAULT now(),

  -- DB-enforced idempotency: two retries with the same client_request_id
  -- cannot both create runs. ON CONFLICT DO NOTHING + lookup handles races.
  CONSTRAINT uq_chat_runs_client_request
    UNIQUE (client_request_id)
)
```

The `chat_runs` table is added to the `supabase_realtime` publication so clients can subscribe to run lifecycle changes.

#### Schema additions to `chat_messages`

| Column | Type | Purpose |
|--------|------|---------|
| `run_id` | UUID, nullable, FK to `chat_runs(id)` | Links assistant message to its run |
| `updated_at` | TIMESTAMPTZ, nullable | Row modification timestamp for Realtime change tracking |

Note: `stream_state`, `last_chunk_at`, `client_request_id`, and cost/token fields live on `chat_runs`, not `chat_messages`. Messages hold content; runs hold lifecycle.

#### New `/api/chat` flow

```
POST /api/chat
  Body: {
    sessionId: "abc123",
    content: "What should I build?",
    model: "anthropic/claude-sonnet-4.6",
    clientRequestId: "req_xyz789"
  }

  Server:
    1. Create run + both messages atomically (single RPC/transaction):
       Call RPC create_run($sessionId, $clientRequestId, $model, $userContent):

         -- Attempt to insert the run. If client_request_id already exists,
         -- this is a retry — skip to lookup.
         INSERT INTO chat_runs (session_id, client_request_id, status, model)
           VALUES ($sessionId, $clientRequestId, 'created', $model)
           ON CONFLICT (client_request_id) DO NOTHING;

         -- Check if we won the insert or hit a conflict
         SELECT id, user_message_id, assistant_message_id, status
           FROM chat_runs WHERE client_request_id = $clientRequestId;

         -- If user_message_id is NOT NULL, the run is already fully built.
         -- Return existing IDs (retry path).

         -- If user_message_id IS NULL, we just created the run (or a
         -- previous attempt crashed before linking messages). Build it:
         INSERT INTO chat_messages (id, session_id, role, content, timestamp)
           VALUES (gen_random_uuid(), $sessionId, 'user', $userContent, now())
           RETURNING id INTO $userMsgId;

         INSERT INTO chat_messages (id, session_id, role, content,
                                    receipt_status, run_id, timestamp)
           VALUES (gen_random_uuid(), $sessionId, 'assistant', '',
                   'metering', $runId, now())
           RETURNING id INTO $assistantMsgId;

         UPDATE chat_runs
           SET user_message_id = $userMsgId,
               assistant_message_id = $assistantMsgId,
               status = 'streaming',
               last_chunk_at = now()
           WHERE id = $runId;

         RETURN ($runId, $userMsgId, $assistantMsgId, 'streaming');

       This entire block runs in one transaction. If the server dies
       mid-transaction, Postgres rolls back — no orphaned run without
       messages. If a retry finds an existing run with NULL message IDs
       (should not happen due to transaction, but as defense-in-depth),
       it repairs by creating the missing messages within the same RPC.

       Retry behavior based on existing run status:
         -> 'streaming': return existing message IDs (client resumes SSE)
         -> 'complete': return completed response (no re-stream)
         -> 'failed'/'timed_out': return error; client generates new
            clientRequestId for a fresh attempt

    2. SSE preamble (before first content chunk):
       data: { type: "ids", runId: "run_abc",
               userMessageId: "msg_abc", assistantMessageId: "msg_xyz" }

    3. Stream content as today, with periodic partial saves:
       UPDATE chat_messages SET content = ..., updated_at = now
         WHERE id = $assistantMessageId
       UPDATE chat_runs SET last_chunk_at = now
         WHERE id = $runId
       (timestamp on chat_messages stays stable for ordering)

    4. Finalize (atomic, exactly-once):
       Call RPC finalize_run($runId, $cost, $tokensIn, $tokensOut, ...):

         UPDATE chat_runs
           SET status = 'complete', cost = $cost, tokens_in = $tokensIn,
               tokens_out = $tokensOut, finalized_at = now()
           WHERE id = $runId AND finalized_at IS NULL;
         -- Returns row count. If 0: already finalized, STOP.
         -- If 1: first finalization, continue:

         UPDATE chat_messages
           SET receipt_status = 'metered', cost = $cost,
               tokens_in = $tokensIn, tokens_out = $tokensOut
           WHERE id = (SELECT assistant_message_id FROM chat_runs WHERE id = $runId);

         UPDATE chat_sessions
           SET total_cost = total_cost + $cost,
               today_cost = today_cost + $cost,
               today_tokens_in = today_tokens_in + $tokensIn,
               today_tokens_out = today_tokens_out + $tokensOut,
               today_message_count = today_message_count + 1,
               updated_at = now()
           WHERE id = $sessionId;

       The finalized_at IS NULL guard ensures this entire block executes
       exactly once, even if retries or duplicate handlers race.
```

**Message ID format:** UUID v4, consistent with existing message IDs generated client-side today.

#### Client-side optimistic updates

```
User hits send:
  1. Generate temp ID: pending_${crypto.randomUUID()}
  2. Generate clientRequestId: req_${crypto.randomUUID()}
  3. Add to Zustand: { id: tempId, role: "user", content, pending: true }
     -> UI renders instantly

  4. POST /api/chat fires
  5. SSE preamble arrives: { runId, userMessageId: "msg_abc", assistantMessageId: "msg_xyz" }
  6. Replace tempId with msg_abc in store
  7. Add assistant message: { id: "msg_xyz", role: "assistant", content: "" }

  8. SSE chunks arrive -> update assistant content directly (fast path)
  9. Realtime INSERT for msg_abc arrives -> already in store, skip (deduplicate by ID)
  10. Realtime INSERT for msg_xyz arrives -> already in store, skip

  11. SSE done + usage -> finalizeResponse() with real cost
  12. Realtime UPDATE on chat_runs (complete) -> cost already current, skip or merge
```

#### Dead stream detection: server-side watchdog (replaces heuristic)

The `cancel()` callback in the chat route sets `status = 'failed'` on the run when the function is interrupted. However, abrupt serverless termination (OOM, infrastructure kill) can bypass this callback, leaving the run in `streaming` state forever.

**Solution: cron watchdog.** A Vercel cron job (extending the existing `/api/cron/settle-all` or as a new `/api/cron/reap-stale-runs`) runs every minute:

```sql
-- Mark stale runs as timed_out (5-minute threshold matches maxDuration=300)
UPDATE chat_runs
  SET status = 'timed_out', finalized_at = now()
  WHERE status = 'streaming'
    AND last_chunk_at < now() - interval '5 minutes'
    AND finalized_at IS NULL
  RETURNING id, assistant_message_id;

-- For each reaped run, mark the assistant message terminal
UPDATE chat_messages
  SET receipt_status = 'metered'
  WHERE id = ANY($reaped_assistant_message_ids)
    AND receipt_status = 'metering';
```

The `finalized_at IS NULL` guard prevents the watchdog from conflicting with a normal finalization that races.

**Client behavior on dead stream:**
- Realtime delivers `chat_runs` UPDATE with `status = 'timed_out'`
- UI shows "Response interrupted" with whatever partial content exists
- Cost on the run is NULL (honestly unknown, not fake $0)
- The message's `receipt_status` becomes `'metered'` so it doesn't retrigger reconnect loops

**Client behavior on stale-but-not-yet-reaped stream (before cron runs):**
- Bootstrap fetch shows run with `status = 'streaming'`, `last_chunk_at` is old
- Client shows streaming indicator but with a "may have stopped" hint after 30s of no Realtime UPDATEs
- Within 1 minute, the cron watchdog resolves it authoritatively

### 4. Bootstrap + Realtime Subscriptions

**Problem:** `useSessionSync` (~500 lines) manages periodic sync, sendBeacon, delta tracking, snapshot hashing, reconnect logic, and visibility change handlers. All of this exists because the client is the source of truth.

**Solution:** Replace with `useRealtimeSync` — a single hook that bootstraps from the server and subscribes to Realtime.

**New hook: `useRealtimeSync`**

```typescript
function useRealtimeSync() {
  // --- Bootstrap ---
  // 1. GET /api/sessions -> all sessions + last 20 messages + active runs
  // 2. Set sessions into Zustand store
  // 3. bootstrapComplete = true -> UI renders

  // --- Subscribe (three channels) ---
  // 4. Subscribe to chat_sessions where user_id = currentUser
  //    -> INSERT: new workspace appeared (created on another device)
  //    -> UPDATE: name change, cost counter update, archived, etc.
  //    -> DELETE: workspace removed

  // 5. Subscribe to chat_messages where session_id = activeSessionId
  //    -> INSERT: new message (from another device, or server-created assistant msg)
  //    -> UPDATE: content growth (streaming), finalization (metered + cost)

  // 6. Subscribe to chat_runs where session_id = activeSessionId
  //    -> INSERT: new run started (another device sent a message)
  //    -> UPDATE: status changes (streaming -> complete/failed/timed_out),
  //              last_chunk_at updates, finalization with cost

  // --- Reconciliation ---
  // 7. After channel status callback reports SUBSCRIBED,
  //    one-time fetch of active session messages + runs
  //    -> If any content is newer than bootstrap, apply delta
  //    -> Closes the gap between bootstrap fetch and subscription start

  // --- Session switching ---
  // 8. When activeSessionId changes:
  //    -> Unsubscribe from old session's chat_messages + chat_runs channels
  //    -> Subscribe to new session's chat_messages + chat_runs channels
  //    -> Fetch messages for new session if not already loaded

  // --- Token refresh ---
  // 9. Every 50 minutes, call GET /api/realtime/token
  //    -> client.realtime.setAuth(newToken)

  // --- Cleanup ---
  // 10. On unmount: unsubscribe from all channels
}
```

**Refresh mid-stream — two scenarios:**

**Scenario A: Stream still active**
```
t=0.0s  User refreshes
t=0.2s  Bootstrap fetch returns:
          assistant message: content partial, receipt_status: "metering"
          chat_run: status "streaming", last_chunk_at: recent
        -> UI renders partial content, shows streaming indicator

t=0.3s  Realtime subscriptions established (messages + runs)
t=0.4s  Reconciliation fetch: content may have grown since bootstrap -> apply delta

t=2.0s  Server partial save -> Realtime UPDATE on chat_messages -> content grows in UI
        Server updates last_chunk_at -> Realtime UPDATE on chat_runs
t=4.0s  Another partial save -> another UPDATE -> more content
t=8.0s  Stream completes -> finalize_run() fires:
          Realtime UPDATE on chat_runs: status "complete", cost: 0.04
          Realtime UPDATE on chat_messages: receipt_status "metered"
          Realtime UPDATE on chat_sessions: cost counters incremented
        -> UI shows final content + cost, stops streaming indicator
```

**Scenario B: Stream completed during refresh**
```
t=0.0s  User refreshes
t=0.1s  Server calls finalize_run() (complete, cost: 0.04)
t=0.2s  Bootstrap fetch returns:
          assistant message: full content, receipt_status: "metered"
          chat_run: status "complete", cost: 0.04, finalized_at: set
        -> UI renders complete message with cost. Done.
```

**Scenario C: Stream died (server killed abruptly)**
```
t=0.0s  User refreshes
t=0.2s  Bootstrap fetch returns:
          assistant message: content partial, receipt_status: "metering"
          chat_run: status "streaming", last_chunk_at: 45 seconds ago
        -> UI renders partial content
        -> Client notices last_chunk_at is stale -> shows "response may have stopped"

t=0.3s  Realtime subscriptions established, no updates arrive
        -> Client shows hint but does NOT guess terminal state

t=~60s  Cron watchdog runs:
          UPDATE chat_runs SET status='timed_out', finalized_at=now()
          UPDATE chat_messages SET receipt_status='metered'
        -> Realtime delivers chat_runs UPDATE with status "timed_out"
        -> UI shows "Response interrupted" definitively
        -> Cost is NULL (honestly unknown), not fake $0
        -> Fallback: /api/chat/resume still available as safety net during transition
```

**What happens to cost counters:**

Session-level cost counters (`todayCost`, `weekCost`, `monthCost`, `totalCost`, token counts) are stored on the `chat_sessions` row in the DB. The chat API route updates them after each message completes. The `chat_sessions` Realtime subscription delivers these updates to all clients.

The sending client still computes `currentMessageCost` locally during streaming (from SSE chunk estimates) for the live cost animation. On finalization, the server's authoritative cost arrives via SSE usage event (sending client) or Realtime UPDATE (other clients).

### 5. Delete Legacy Sync + Fix Subtracks

**What gets deleted:**

| Code | Location | Lines (approx) |
|------|----------|-----------------|
| `syncToServer()` + delta tracking | `use-session-sync.ts:160-362` | ~200 |
| `sendBeacon` / `beforeunload` / `pagehide` handlers | `use-session-sync.ts:434-556` | ~120 |
| Visibility change re-fetch handler | `use-session-sync.ts:558-649` | ~90 |
| `reconnectToStream()` | `use-session-sync.ts:917-1017` | ~100 |
| `loadSessions()` merge logic | `use-session-sync.ts:657-908` | ~250 |
| `POST /api/sessions` handler | `app/api/sessions/route.ts:152-296` | ~145 |
| `GET /api/chat/resume` endpoint | `app/api/chat/resume/route.ts` | ~200 |
| `logout()` sync + sendBeacon logic | `store.ts:627-686` | ~60 |
| Snapshot hashing, backoff, sync counters | `use-session-sync.ts` various | ~50 |
| `useSessionSync` hook entirely | `use-session-sync.ts` | entire file |

**Logout becomes:**

```typescript
logout: async () => {
  set({ loggingOut: true });

  // Unsubscribe from Realtime
  supabase.removeAllChannels();

  // Fire-and-forget server session cleanup
  authFetch("/api/auth/logout", { method: "POST" }).catch(() => {});

  // Clear store
  set({
    userId: null, authenticated: false, sessions: [],
    activeSessionId: null, loggingOut: false,
    // ... reset all fields
  });

  // Clear localStorage (only UI prefs and drafts)
  localStorage.removeItem("meter-store-v3");
  localStorage.removeItem("workspace-store-v1");
}
```

**Subtrack fix:**

Current problem: `createSubtrackSession` in `store.ts` clones all parent messages into the subtrack's session. This duplicates message IDs across sessions, causing the sync layer to steal messages from main when it upserts.

New behavior:
- Subtracks store only post-fork messages in `chat_messages` (as the sync layer already tries to do, but inconsistently)
- The UI composes the view at render time: parent messages up to fork point + subtrack messages after fork
- `POST /api/workspaces` with `{ isSubtrack: true, parentSessionId, forkMessageId }` creates the subtrack record
- The `fork_message_id` on `chat_sessions` tells the client where to split

---

## Migration

**New table:** `chat_runs` is created fresh — no migration of existing data needed. Existing messages that were created before the runs system will simply not have a `run_id` (nullable FK). The UI handles this gracefully: messages without a run are treated as complete (legacy data).

**Schema additions to existing tables:**
- `chat_messages.run_id` (UUID, nullable FK) — new column, nullable for backwards compatibility
- `chat_messages.updated_at` (TIMESTAMPTZ, nullable) — new column
- No columns removed from existing tables

**Existing workspace IDs:** Old `ws_*` session IDs in the DB continue to work. They're already stored with the `userId:` prefix. The fix is that *new* workspaces get server-minted IDs that are consistent across devices.

**localStorage on first load after deploy:** The app will fetch sessions from the server (as it does today) and populate the store. Since localStorage is now just a cache, any stale data in `meter-store-v3` is harmlessly ignored — the server bootstrap overwrites it.

**Supabase RPC:** A new `finalize_run` RPC function is created in `setup-db/route.ts` to execute the exactly-once finalization atomically.

---

## PR Plan

### PR1: Realtime Auth Bridge + Schema Prep

**Scope:** Additive only. No existing behavior changes.

- New `GET /api/realtime/token` endpoint: validates cookie auth, mints short-lived JWT
- New browser-side Supabase client setup with JWT auth for Realtime
- Schema additions in `setup-db/route.ts`:
  - New `chat_runs` table (full schema above)
  - `chat_messages.run_id` (UUID, nullable FK to `chat_runs`)
  - `chat_messages.updated_at` (TIMESTAMPTZ, nullable)
  - New `create_run` RPC function (atomic run + message creation in one transaction; idempotent retry via `ON CONFLICT` + repair)
  - New `finalize_run` RPC function (atomic finalization with `finalized_at IS NULL` guard)
  - Add `chat_sessions`, `chat_messages`, and `chat_runs` to `supabase_realtime` publication
  - JWT-based RLS SELECT policies for Realtime subscriptions on all three tables
- Verification test: logged-in browser subscribes to its own `chat_sessions`, `chat_messages`, and `chat_runs` rows; another user's rows are not visible

**Done when:** A browser can subscribe and receive Postgres Changes events for its own data.

### PR2: Server Mints Workspace IDs

**Scope:** Workspace creation/mutation moves server-side.

- New `POST /api/workspaces` endpoint
- New `PATCH /api/workspaces/:id` endpoint
- `workspace-store.ts:createWorkspace` becomes async server call
- `workspace-store.ts` stops generating `ws_*` IDs
- Workspace list still loaded via existing `GET /api/sessions` bootstrap (Realtime subscription for workspaces comes in PR4)

**Done when:** Creating a workspace on desktop and phone yields one shared canonical workspace.

### PR3: Server Mints Message IDs + Durable Runs

**Scope:** Message creation, run lifecycle, and exactly-once finalization move server-side.

- `/api/chat` calls `create_run` RPC which atomically creates the `chat_runs` row + both message rows in one transaction (no orphaned runs). Retries hit the `UNIQUE(client_request_id)` constraint and look up the existing run.
- SSE preamble event: `{ type: "ids", runId, userMessageId, assistantMessageId }`
- `chat-view.tsx` stops generating message IDs; uses temp IDs for optimistic display, swaps on preamble
- `clientRequestId` generated client-side, enforced unique by DB constraint — retries reuse existing run
- Partial saves update `chat_messages.updated_at` and `chat_runs.last_chunk_at` (message `timestamp` stays stable for ordering)
- Finalization calls `finalize_run` RPC (atomic, exactly-once via `finalized_at IS NULL` guard)
- Run status lifecycle: `created` -> `streaming` -> `complete` / `failed` / `timed_out`
- `cancel()` callback sets run status to `failed`; cron watchdog handles cases where callback doesn't fire
- New cron job `/api/cron/reap-stale-runs` (or extend `settle-all`): marks runs with `status='streaming'` and `last_chunk_at > 5 min ago` as `timed_out`

**Done when:** Refreshing or retrying the same request cannot create duplicate rows, finalization cannot double-apply cost counters, and the sending tab reconciles temp IDs to canonical IDs.

### PR4: Bootstrap + Realtime Subscriptions

**Scope:** Read path switches from sync-based to subscription-based.

- New `useRealtimeSync` hook with three Realtime channels:
  - `chat_sessions` by `user_id` — workspace list, cost counters, renames
  - `chat_messages` by `session_id` — messages for active thread
  - `chat_runs` by `session_id` — run lifecycle (streaming status, finalization, dead stream detection)
- Bootstrap fetch -> subscribe -> reconciliation fetch three-step pattern
- Direct SSE from `/api/chat` for sending tab (fast path); Realtime for other devices
- `partialize` shrinks to UI preferences only (no messages, sessions, or counters)
- `/api/chat/resume` kept as fallback for streaming messages if Realtime doesn't deliver within 5s
- Old `syncToServer` periodic timer disabled (but code not yet deleted)

**Done when:** A second device sees new messages and finalized costs without polling, and a refresh recovers from server state without merge heuristics.

### PR5: Delete Legacy Sync + Fix Subtracks

**Scope:** Remove old infrastructure, clean up subtracks.

- Delete `useSessionSync` entirely (replaced by `useRealtimeSync`)
- Delete `POST /api/sessions` endpoint
- Delete `/api/chat/resume` endpoint (if Realtime proved stable in PR4)
- Simplify `logout()` to just cache clearing
- Fix `createSubtrackSession` to stop cloning parent messages; compose at render time
- Remove `sendBeacon`, `beforeunload`/`pagehide` handlers, snapshot hashing, delta tracking, sync counters, backoff logic

**Done when:** Logout is just cache clearing, refresh doesn't affect persistence, and subtracks cannot steal messages from main.

---

## Files Affected

### Modified

| File | PR | Changes |
|------|----|---------|
| `src/lib/supabase.ts` | 1 | Add browser client with JWT Realtime auth |
| `src/app/api/setup-db/route.ts` | 1 | Add `chat_runs` table, `chat_messages.run_id` + `updated_at` columns, `finalize_run` RPC, publication setup, RLS policies |
| `src/lib/workspace-store.ts` | 2 | `createWorkspace` becomes async server call; remove ID generation |
| `src/app/api/chat/route.ts` | 3 | Create run + message rows before streaming; SSE preamble with runId; call `finalize_run` RPC; `cancel()` sets run status to `failed` |
| `src/components/chat-view.tsx` | 3 | Stop generating message IDs; generate `clientRequestId`; optimistic update + temp ID swap on SSE preamble |
| `src/lib/store.ts` | 3-5 | Remove message sync from partialize; simplify logout; fix subtracks |
| `vercel.json` | 3 | Add cron schedule for `/api/cron/reap-stale-runs` |

### New

| File | PR | Purpose |
|------|----|---------|
| `src/app/api/realtime/token/route.ts` | 1 | Mint JWT for Realtime auth |
| `src/app/api/workspaces/route.ts` | 2 | Create + list workspaces |
| `src/app/api/workspaces/[id]/route.ts` | 2 | Update + delete workspaces |
| `src/app/api/cron/reap-stale-runs/route.ts` | 3 | Cron watchdog: mark stale `streaming` runs as `timed_out` |
| `src/lib/use-realtime-sync.ts` | 4 | Bootstrap + Realtime subscription hook (3 channels) |

### Deleted

| File | PR | Reason |
|------|----|--------|
| `src/lib/use-session-sync.ts` | 5 | Replaced by `use-realtime-sync.ts` |
| `src/app/api/chat/resume/route.ts` | 5 | Replaced by Realtime subscriptions + `chat_runs` lifecycle |

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| Supabase Realtime drops events (network blip) | Reconciliation fetch on subscription reconnect; Supabase client has built-in reconnection |
| JWT token expires mid-session | Auto-refresh every 50 minutes; Realtime client handles re-auth gracefully |
| Large message content in Realtime payload (>1MB) | Supabase Realtime has ~1MB row limit; chat messages are typically well under this. If hit, partial save frequency can be reduced |
| Sending device SSE + Realtime both deliver same update | Deduplication by message ID; Realtime UPDATE for content already shown via SSE is a no-op |
| `/api/chat` server-side message/run creation adds latency before first chunk | Run + message INSERTs are ~20-30ms total; imperceptible. Optimistic update means UI already shows the user message |
| Subtrack message composition at render time is complex | Fork point is stored as `fork_message_id` on `chat_sessions`; query parent messages up to that ID, append subtrack messages |
| Abrupt serverless termination bypasses `cancel()` callback | Cron watchdog runs every minute, marks stale runs (>5 min since last chunk) as `timed_out`; `finalized_at IS NULL` guard prevents conflict with normal finalization |
| Retry creates duplicate run/messages | `UNIQUE(client_request_id)` on `chat_runs` + `ON CONFLICT DO NOTHING` ensures DB-enforced idempotency; retry looks up existing run |
| Finalization double-applies cost counters | `finalize_run` RPC uses `finalized_at IS NULL` guard in same transaction as counter update; second call is a no-op |
| `chat_runs` table adds query overhead to bootstrap | Bootstrap only fetches active runs (`status IN ('created', 'streaming')`) — typically 0-1 rows; negligible |
| Server dies after run INSERT but before messages are linked | `create_run` RPC wraps all three INSERTs in one transaction; Postgres rolls back on crash. Defense-in-depth: retry detects NULL `user_message_id` and repairs within the same RPC |
