# PR1: Realtime Auth Bridge + Schema Prep — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enable Supabase Realtime subscriptions authenticated via short-lived JWTs, and prepare the database schema (`chat_runs` table, new columns, RPC functions, RLS policies, publication) for the server-authoritative architecture.

**Architecture:** A new `/api/realtime/token` endpoint mints HS256 JWTs from the cookie-based session. The browser Supabase client (already defined but unused) uses `setAuth()` to authenticate Realtime channels. All schema changes are additive — no existing behavior changes. The `setup-db/route.ts` STATEMENTS array gets new entries appended at the end.

**Tech Stack:** Next.js 15 API routes, `jose` (JWT signing), Supabase JS v2 (`@supabase/supabase-js`), Supabase Realtime (Postgres Changes), PostgreSQL DDL/RPC.

**Spec:** `docs/superpowers/specs/2026-04-04-server-authoritative-state-design.md`

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/realtime/token/route.ts` | Create | Mint short-lived JWT for Realtime auth |
| `src/lib/supabase-realtime.ts` | Create | Browser-side Supabase client singleton for Realtime, with `setAuth()` and token refresh |
| `src/app/api/setup-db/route.ts` | Modify (append to STATEMENTS array) | Add `chat_runs` table, `chat_messages` columns, `create_run` + `finalize_run` RPCs, publication, RLS policies |
| `.env.example` | Modify | Add `SUPABASE_JWT_SECRET` |
| `src/lib/supabase.ts` | No change | Existing `getSupabaseBrowser()` stays unused for now; the new `supabase-realtime.ts` handles the Realtime-specific client |

---

## Task 1: Install `jose` and add env var

**Files:**
- Modify: `package.json` (via `bun add`)
- Modify: `.env.example`

- [ ] **Step 1: Install jose**

```bash
cd /Users/osamaaamer/conductor/workspaces/meter/berlin && bun add jose
```

`jose` is a lightweight, ESM-compatible JWT library that works on Vercel Edge and Node.js runtimes. It has zero dependencies.

- [ ] **Step 2: Add SUPABASE_JWT_SECRET to .env.example**

In `.env.example`, after the existing Supabase vars (around line 28), add:

```
# Supabase JWT secret — used to sign tokens for Realtime auth.
# Found in Supabase Dashboard → Settings → API → JWT Secret.
SUPABASE_JWT_SECRET=your-supabase-jwt-secret-here
```

- [ ] **Step 3: Set the real secret in your local .env.local**

Get the JWT secret from the Supabase Dashboard (Settings → API → JWT Secret) and add it to `.env.local`:

```
SUPABASE_JWT_SECRET=<paste-real-secret>
```

- [ ] **Step 4: Commit**

```bash
git add package.json bun.lock .env.example
git commit -m "chore: install jose, add SUPABASE_JWT_SECRET env var"
```

---

## Task 2: Create `/api/realtime/token` endpoint

**Files:**
- Create: `src/app/api/realtime/token/route.ts`

- [ ] **Step 1: Create the token endpoint**

```typescript
// src/app/api/realtime/token/route.ts
import { NextResponse } from "next/server";
import { SignJWT } from "jose";
import { requireAuth } from "@/lib/auth";

// GET /api/realtime/token — mint a short-lived JWT for Supabase Realtime.
// The browser calls this on page load and every 50 minutes to refresh.
// The JWT contains the user's ID so Supabase RLS policies can filter
// Realtime events to only this user's data.
export async function GET() {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  const secret = process.env.SUPABASE_JWT_SECRET;
  if (!secret) {
    return NextResponse.json(
      { error: "SUPABASE_JWT_SECRET not configured" },
      { status: 500 },
    );
  }

  const key = new TextEncoder().encode(secret);

  const token = await new SignJWT({
    sub: userId,
    role: "authenticated",
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("1h")
    .sign(key);

  return NextResponse.json({ token });
}
```

- [ ] **Step 2: Verify it works**

Start the dev server and call the endpoint with your session cookie:

```bash
curl -s http://localhost:3000/api/realtime/token \
  -H "Cookie: meter_session=<your-session-token>" | jq .
```

Expected: `{ "token": "eyJ..." }` — a valid JWT.

Decode the token to verify the payload:

```bash
# Copy the token value, then:
echo "<token>" | cut -d. -f2 | base64 -d 2>/dev/null | jq .
```

Expected: `{ "sub": "<your-user-id>", "role": "authenticated", "iat": ..., "exp": ... }`

- [ ] **Step 3: Verify unauthenticated requests are rejected**

```bash
curl -s http://localhost:3000/api/realtime/token | jq .
```

Expected: `401` status with error message.

- [ ] **Step 4: Commit**

```bash
git add src/app/api/realtime/token/route.ts
git commit -m "feat: add /api/realtime/token endpoint for Supabase Realtime JWT auth"
```

---

## Task 3: Add `chat_runs` table to setup-db

**Files:**
- Modify: `src/app/api/setup-db/route.ts` (append to STATEMENTS array before the closing `];` at line 652)

- [ ] **Step 1: Add the chat_runs table DDL**

Append this statement to the STATEMENTS array (before the closing `];`):

```typescript
  // ── PR1: Server-authoritative state — chat_runs table ──────────
  // NOTE: user_message_id and assistant_message_id are TEXT, not UUID,
  // because chat_messages.id is TEXT (client-generated IDs like "a1b2c3d4").
  // chat_runs.id is also TEXT for consistency with the rest of the schema.
  `create table if not exists chat_runs (
    id text primary key default gen_random_uuid()::text,
    session_id text not null references chat_sessions(id),
    client_request_id text,
    user_message_id text,
    assistant_message_id text,
    status text not null default 'created',
    model text,
    cost numeric,
    tokens_in integer,
    tokens_out integer,
    cache_creation_tokens integer,
    cache_read_tokens integer,
    last_chunk_at timestamptz,
    finalized_at timestamptz,
    created_at timestamptz default now()
  )`,
```

- [ ] **Step 2: Add the unique constraint on client_request_id**

Append after the table creation:

```typescript
  // Idempotency constraint — prevents duplicate runs from retries.
  // Partial unique index: only enforced when client_request_id is not null.
  `create unique index if not exists uq_chat_runs_client_request
   on chat_runs (client_request_id)
   where client_request_id is not null`,
```

- [ ] **Step 3: Add indexes for chat_runs**

```typescript
  `create index if not exists idx_chat_runs_session on chat_runs (session_id)`,
  `create index if not exists idx_chat_runs_status on chat_runs (status) where status in ('created', 'streaming')`,
```

- [ ] **Step 4: Commit**

```bash
git add src/app/api/setup-db/route.ts
git commit -m "schema: add chat_runs table with idempotency constraint"
```

---

## Task 4: Add new columns to `chat_messages`

**Files:**
- Modify: `src/app/api/setup-db/route.ts` (append to STATEMENTS array)

- [ ] **Step 1: Add run_id and updated_at columns**

```typescript
  // Link assistant messages to their run (nullable for legacy messages)
  `alter table chat_messages add column if not exists run_id text references chat_runs(id)`,
  // Row modification timestamp for Realtime change tracking.
  // Separate from "timestamp" which is stable for ordering.
  `alter table chat_messages add column if not exists updated_at timestamptz`,
```

- [ ] **Step 2: Add index on run_id**

```typescript
  `create index if not exists idx_chat_messages_run on chat_messages (run_id) where run_id is not null`,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/setup-db/route.ts
git commit -m "schema: add run_id and updated_at columns to chat_messages"
```

---

## Task 5: Add `create_run` RPC function

**Files:**
- Modify: `src/app/api/setup-db/route.ts` (append to STATEMENTS array)

- [ ] **Step 1: Add the create_run RPC**

This function atomically creates a run + both messages in one transaction. Concurrent retries are serialized by `SELECT ... FOR UPDATE` on the run row, so only one caller builds the messages. The fully-built check verifies BOTH `user_message_id` AND `assistant_message_id` are non-null.

```typescript
  `create or replace function create_run(
    p_session_id text,
    p_client_request_id text,
    p_model text,
    p_user_content text
  ) returns table (
    run_id text,
    user_message_id text,
    assistant_message_id text,
    run_status text
  ) as $$
  declare
    v_run_id text;
    v_user_msg_id text;
    v_asst_msg_id text;
    v_status text;
  begin
    -- Attempt insert; ON CONFLICT means this client_request_id already exists (retry).
    insert into chat_runs (session_id, client_request_id, status, model)
      values (p_session_id, p_client_request_id, 'created', p_model)
      on conflict (client_request_id) where client_request_id is not null
      do nothing;

    -- Lock the run row. This serializes concurrent retries: if two callers
    -- hit this simultaneously, one blocks until the other commits.
    -- Without FOR UPDATE, both could see NULL message IDs and both create messages.
    select cr.id, cr.user_message_id, cr.assistant_message_id, cr.status
      into v_run_id, v_user_msg_id, v_asst_msg_id, v_status
      from chat_runs cr
      where cr.client_request_id = p_client_request_id
      for update;

    -- Fully built = BOTH message IDs are set. Checking only one is a bug:
    -- a crash after inserting the user message but before the assistant message
    -- would leave a half-built run that looks "complete" if we only check one.
    if v_user_msg_id is not null and v_asst_msg_id is not null then
      return query
        select v_run_id, v_user_msg_id, v_asst_msg_id, v_status;
      return;
    end if;

    -- Run exists but messages are missing — create them (first call or repair).
    -- If only one message exists (partial crash), create the missing one.
    if v_user_msg_id is null then
      insert into chat_messages (id, session_id, role, content, timestamp)
        values (gen_random_uuid()::text, p_session_id, 'user', p_user_content,
                extract(epoch from now()) * 1000)
        returning id into v_user_msg_id;
    end if;

    if v_asst_msg_id is null then
      insert into chat_messages (id, session_id, role, content, receipt_status, run_id, timestamp)
        values (gen_random_uuid()::text, p_session_id, 'assistant', '',
                'metering', v_run_id, extract(epoch from now()) * 1000)
        returning id into v_asst_msg_id;
    end if;

    update chat_runs
      set user_message_id = v_user_msg_id,
          assistant_message_id = v_asst_msg_id,
          status = 'streaming',
          last_chunk_at = now()
      where id = v_run_id;

    return query
      select v_run_id, v_user_msg_id, v_asst_msg_id, 'streaming'::text;
  end;
  $$ language plpgsql security definer`,
```

Key safety properties:
- `FOR UPDATE` on the run row serializes concurrent callers — the second caller blocks until the first commits
- Both `user_message_id` AND `assistant_message_id` must be non-null for the run to be considered fully built
- Each message is created independently with `IF ... IS NULL` guards, so partial crashes are repaired
- Message IDs are `text` (matching `chat_messages.id` type), generated as `gen_random_uuid()::text`
- `timestamp` uses `extract(epoch from now()) * 1000` to match the existing millisecond convention

- [ ] **Step 2: Commit**

```bash
git add src/app/api/setup-db/route.ts
git commit -m "schema: add create_run RPC (atomic run + message creation)"
```

---

## Task 6: Add `finalize_run` RPC function

**Files:**
- Modify: `src/app/api/setup-db/route.ts` (append to STATEMENTS array)

- [ ] **Step 1: Add the finalize_run RPC**

This function atomically finalizes a run: updates the run, the assistant message, and the session cost counters. The `finalized_at IS NULL` guard ensures it executes exactly once.

```typescript
  `create or replace function finalize_run(
    p_run_id text,
    p_cost numeric,
    p_tokens_in integer,
    p_tokens_out integer,
    p_cache_creation_tokens integer default null,
    p_cache_read_tokens integer default null
  ) returns boolean as $$
  declare
    v_updated int;
    v_assistant_msg_id text;
    v_session_id text;
  begin
    -- Exactly-once guard: only the first caller gets past this.
    update chat_runs
      set status = 'complete',
          cost = p_cost,
          tokens_in = p_tokens_in,
          tokens_out = p_tokens_out,
          cache_creation_tokens = p_cache_creation_tokens,
          cache_read_tokens = p_cache_read_tokens,
          finalized_at = now()
      where id = p_run_id
        and finalized_at is null;

    get diagnostics v_updated = row_count;
    if v_updated = 0 then
      -- Already finalized — return false so caller knows to skip counter updates.
      return false;
    end if;

    -- Fetch IDs for the dependent updates
    select assistant_message_id, session_id
      into v_assistant_msg_id, v_session_id
      from chat_runs where id = p_run_id;

    -- Update the assistant message to metered
    update chat_messages
      set receipt_status = 'metered',
          cost = p_cost,
          tokens_in = p_tokens_in,
          tokens_out = p_tokens_out,
          cache_creation_tokens = p_cache_creation_tokens,
          cache_read_tokens = p_cache_read_tokens,
          updated_at = now()
      where id = v_assistant_msg_id;

    -- Increment session cost counters
    update chat_sessions
      set total_cost = coalesce(total_cost, 0) + coalesce(p_cost, 0),
          today_cost = coalesce(today_cost, 0) + coalesce(p_cost, 0),
          today_tokens_in = coalesce(today_tokens_in, 0) + coalesce(p_tokens_in, 0),
          today_tokens_out = coalesce(today_tokens_out, 0) + coalesce(p_tokens_out, 0),
          today_message_count = coalesce(today_message_count, 0) + 1,
          updated_at = now()
      where id = v_session_id;

    return true;
  end;
  $$ language plpgsql security definer`,
```

- [ ] **Step 2: Commit**

```bash
git add src/app/api/setup-db/route.ts
git commit -m "schema: add finalize_run RPC (exactly-once finalization)"
```

---

## Task 7: Add Realtime publication and RLS policies

**Files:**
- Modify: `src/app/api/setup-db/route.ts` (append to STATEMENTS array)

- [ ] **Step 1: Add publication setup**

Supabase Realtime requires tables to be in the `supabase_realtime` publication. Supabase projects have this publication created by default, but tables must be added to it explicitly.

```typescript
  // ── Realtime publication ──────────────────────────────────────
  // Add tables to the supabase_realtime publication so Postgres Changes
  // events are emitted. The publication already exists in Supabase projects.
  // ALTER PUBLICATION ... ADD TABLE is idempotent if the table is already a member.
  `do $$
   begin
     alter publication supabase_realtime add table chat_sessions;
   exception when others then
     raise notice 'chat_sessions already in publication or publication missing';
   end $$`,
  `do $$
   begin
     alter publication supabase_realtime add table chat_messages;
   exception when others then
     raise notice 'chat_messages already in publication or publication missing';
   end $$`,
  `do $$
   begin
     alter publication supabase_realtime add table chat_runs;
   exception when others then
     raise notice 'chat_runs already in publication or publication missing';
   end $$`,
```

- [ ] **Step 2: Add RLS policies for Realtime (JWT-based)**

These policies allow the browser Supabase client (authenticated with our custom JWT) to SELECT rows it owns. The existing service-role queries bypass RLS and are unaffected.

The JWT's `sub` claim contains the user ID. Supabase makes this available as `auth.uid()` when using Realtime with `setAuth()`.

However, the existing RLS policies already use `current_setting('app.user_id', true)` which is set via the `set_app_user` RPC. For Realtime, Supabase uses `auth.jwt() ->> 'sub'` instead. We need policies that work for BOTH patterns.

The simplest approach: add new policies specifically for the `authenticated` role that check `auth.jwt() ->> 'sub'`.

```typescript
  // ── Realtime RLS policies (JWT-based) ─────────────────────────
  // These policies allow Realtime subscribers (authenticated via our
  // custom JWT) to receive change events for their own data.
  // They coexist with existing owner policies (which use app.user_id).

  // Enable RLS on chat_runs (new table)
  `alter table chat_runs enable row level security`,

  // chat_runs: owner can read their own runs
  `do $$
   begin
     create policy chat_runs_owner on chat_runs
       for all using (
         session_id in (
           select id from chat_sessions where user_id = coalesce(
             auth.jwt() ->> 'sub',
             current_setting('app.user_id', true)
           )
         )
       );
   exception when duplicate_object then null;
   end $$`,

  // chat_sessions: Realtime read via JWT sub
  `do $$
   begin
     create policy chat_sessions_realtime on chat_sessions
       for select using (
         user_id = (auth.jwt() ->> 'sub')
       );
   exception when duplicate_object then null;
   end $$`,

  // chat_messages: Realtime read via JWT sub (through session ownership)
  `do $$
   begin
     create policy chat_messages_realtime on chat_messages
       for select using (
         session_id in (
           select id from chat_sessions where user_id = (auth.jwt() ->> 'sub')
         )
       );
   exception when duplicate_object then null;
   end $$`,

  // chat_runs: Realtime read via JWT sub (through session ownership)
  `do $$
   begin
     create policy chat_runs_realtime on chat_runs
       for select using (
         session_id in (
           select id from chat_sessions where user_id = (auth.jwt() ->> 'sub')
         )
       );
   exception when duplicate_object then null;
   end $$`,
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/setup-db/route.ts
git commit -m "schema: add Realtime publication and JWT-based RLS policies"
```

---

## Task 8: Create browser-side Realtime client

**Files:**
- Create: `src/lib/supabase-realtime.ts`

- [ ] **Step 1: Create the Realtime client module**

This module provides a singleton Supabase client configured for Realtime subscriptions. It handles JWT auth and token refresh. It is NOT used by server-side code.

```typescript
// src/lib/supabase-realtime.ts
"use client";

import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { authFetch } from "@/lib/auth-fetch";

// Cache the initialization PROMISE, not the client. This prevents a race
// where two callers both see `client === null`, both start initializing,
// and one returns the client before setAuth() completes.
let initPromise: Promise<SupabaseClient> | null = null;
let client: SupabaseClient | null = null;
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const TOKEN_REFRESH_MS = 50 * 60 * 1000; // 50 minutes (token expires in 60)

async function fetchRealtimeToken(): Promise<string> {
  const res = await authFetch("/api/realtime/token");
  if (!res.ok) throw new Error(`Failed to fetch Realtime token: ${res.status}`);
  const data = await res.json();
  return data.token;
}

async function initialize(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) throw new Error("Missing Supabase env vars");

  const newClient = createClient(url, anonKey, {
    realtime: {
      params: { eventsPerSecond: 10 },
    },
  });

  // Authenticate BEFORE exposing the client
  const token = await fetchRealtimeToken();
  newClient.realtime.setAuth(token);

  // Refresh token before expiry
  refreshTimer = setInterval(async () => {
    try {
      const newToken = await fetchRealtimeToken();
      newClient.realtime.setAuth(newToken);
    } catch {
      // Token refresh failed — Realtime will disconnect on expiry.
      // The Supabase client's built-in reconnect will retry.
    }
  }, TOKEN_REFRESH_MS);

  client = newClient;
  return newClient;
}

/**
 * Get (or create) the browser-side Supabase client for Realtime subscriptions.
 * On first call, fetches a JWT from /api/realtime/token and starts a
 * 50-minute refresh timer. Concurrent callers share the same initialization
 * promise, so the client is never returned before authentication completes.
 */
export function getRealtimeClient(): Promise<SupabaseClient> {
  if (!initPromise) {
    initPromise = initialize();
  }
  return initPromise;
}

/**
 * Tear down the Realtime client. Removes all channels, stops the token
 * refresh timer, and resets the singleton. Call on logout.
 */
export function destroyRealtimeClient() {
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  if (client) {
    client.removeAllChannels();
    client = null;
  }
  initPromise = null;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/lib/supabase-realtime.ts
git commit -m "feat: add browser-side Supabase Realtime client with JWT auth"
```

---

## Task 9: Run setup-db and verify schema

- [ ] **Step 1: Start the dev server**

```bash
cd /Users/osamaaamer/conductor/workspaces/meter/berlin && bun run dev
```

- [ ] **Step 2: Run setup-db to apply schema changes**

Call the setup-db endpoint (requires superadmin auth):

```bash
curl -s http://localhost:3000/api/setup-db \
  -H "Cookie: meter_session=<your-session-token>" | jq .
```

Check the output for errors. All new statements should succeed. Some may report "already exists" which is fine (idempotent).

- [ ] **Step 3: Verify chat_runs table exists**

Open the Supabase Dashboard → Table Editor → verify `chat_runs` table exists with all columns.

Alternatively, check via SQL Editor:

```sql
select column_name, data_type, is_nullable
from information_schema.columns
where table_name = 'chat_runs'
order by ordinal_position;
```

Expected: 15 columns, all TEXT for IDs (id, session_id, client_request_id, user_message_id, assistant_message_id) matching `chat_messages.id` type.

- [ ] **Step 4: Verify chat_messages new columns**

```sql
select column_name, data_type
from information_schema.columns
where table_name = 'chat_messages' and column_name in ('run_id', 'updated_at');
```

Expected: 2 rows (run_id uuid, updated_at timestamptz).

- [ ] **Step 5: Verify RPCs exist**

```sql
select routine_name from information_schema.routines
where routine_schema = 'public' and routine_name in ('create_run', 'finalize_run');
```

Expected: 2 rows.

- [ ] **Step 6: Verify publication includes tables**

```sql
select tablename from pg_publication_tables where pubname = 'supabase_realtime';
```

Expected: `chat_sessions`, `chat_messages`, `chat_runs` should all be listed.

---

## Task 10: End-to-end Realtime verification

- [ ] **Step 1: Test Realtime subscription from browser console**

Open the app in a browser (logged in). Open the browser dev console and run:

```javascript
// Fetch a Realtime token
const res = await fetch("/api/realtime/token");
const { token } = await res.json();
console.log("Got token:", token.slice(0, 20) + "...");

// Create a Supabase client and authenticate for Realtime
const { createClient } = await import("https://esm.sh/@supabase/supabase-js@2");
const supabase = createClient(
  "<your-supabase-url>",  // replace with your NEXT_PUBLIC_SUPABASE_URL
  "<your-anon-key>",      // replace with your NEXT_PUBLIC_SUPABASE_ANON_KEY
);
supabase.realtime.setAuth(token);

// Subscribe to chat_sessions changes
const channel = supabase
  .channel("test-realtime")
  .on("postgres_changes", {
    event: "*",
    schema: "public",
    table: "chat_sessions",
  }, (payload) => {
    console.log("Realtime event:", payload);
  })
  .subscribe((status) => {
    console.log("Subscription status:", status);
  });
```

Expected: Console logs `Subscription status: SUBSCRIBED`.

- [ ] **Step 2: Trigger a change and verify the event arrives**

In a separate tab or the Supabase SQL Editor, update a session you own:

```sql
update chat_sessions
set updated_at = now()
where user_id = '<your-scoped-user-id>'
limit 1;
```

Expected: The browser console logs a Realtime event with `eventType: "UPDATE"` and the updated row.

- [ ] **Step 3: Verify RLS blocks other users' events**

The subscription above subscribes to ALL `chat_sessions` rows, but RLS should filter to only this user's rows. Update a row belonging to a different user (if one exists) or verify by checking that only your rows appear.

- [ ] **Step 4: Clean up the test channel**

```javascript
supabase.removeAllChannels();
```

- [ ] **Step 5: Commit the final state**

If any adjustments were needed during verification, commit them:

```bash
git add -A
git commit -m "chore: adjustments from Realtime verification testing"
```

If no changes were needed, skip this step.

---

## Verification Checklist

After all tasks are complete, confirm:

- [ ] `GET /api/realtime/token` returns a valid JWT for authenticated users and 401 for unauthenticated
- [ ] `chat_runs` table exists with all 15 columns + unique index on `client_request_id`
- [ ] `chat_messages` has `run_id` and `updated_at` columns
- [ ] `create_run` and `finalize_run` RPCs exist
- [ ] `chat_sessions`, `chat_messages`, and `chat_runs` are in the `supabase_realtime` publication
- [ ] A browser can subscribe to Realtime and receive change events for its own data
- [ ] No existing behavior has changed — the app works exactly as before
