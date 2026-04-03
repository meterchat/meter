# PR2: Server Mints Workspace IDs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move workspace creation and mutation to the server so all devices share canonical workspace IDs, eliminating split chat histories.

**Architecture:** New `POST /api/workspaces` and `PATCH /api/workspaces/[id]` endpoints create and modify `chat_sessions` rows. The client's `workspace-store.ts` stops generating `ws_*` IDs and instead calls the server. The workspace list is still loaded via the existing `GET /api/sessions` bootstrap (Realtime subscription comes in PR4).

**Tech Stack:** Next.js 15 API routes, Supabase, Zustand store.

**Spec:** `docs/superpowers/specs/2026-04-04-server-authoritative-state-design.md` — Section 2

**Depends on:** PR1 (schema prep) must be deployed first.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/app/api/workspaces/route.ts` | Create | POST: create workspace, GET: list workspaces |
| `src/app/api/workspaces/[id]/route.ts` | Create | PATCH: rename/archive, DELETE: soft-delete |
| `src/lib/workspace-store.ts` | Modify | `createWorkspace` becomes async server call; stop generating `ws_*` IDs |
| `src/lib/store.ts` | Modify | `addSession` called after server returns canonical ID |

---

## Task 1: Create `POST /api/workspaces` endpoint

**Files:**
- Create: `src/app/api/workspaces/route.ts`

- [ ] **Step 1: Create the workspaces route with POST handler**

```typescript
// src/app/api/workspaces/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";
import crypto from "crypto";

function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

function unscopedId(userId: string, dbId: string): string {
  const prefix = `${userId}:`;
  return dbId.startsWith(prefix) ? dbId.slice(prefix.length) : dbId;
}

// POST /api/workspaces — create or get a workspace (server-minted ID)
//
// Supports get-or-create semantics: if `idempotencyKey` is provided (e.g.
// "default" for the initial workspace), the server returns the existing
// workspace for that user+key instead of creating a duplicate. This ensures
// two devices logging in for the first time converge on the same workspace.
export async function POST(req: NextRequest) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;

  try {
    const body = await req.json();
    const name = (body.name as string)?.trim();
    if (!name) {
      return NextResponse.json({ error: "Missing name" }, { status: 400 });
    }

    const supabase = getSupabaseServer();
    const idempotencyKey = (body.idempotencyKey as string) ?? null;

    // Get-or-create: if idempotencyKey is provided, check for existing workspace
    if (idempotencyKey) {
      const tag = `${userId}:idem:${idempotencyKey}`;
      const { data: existing } = await supabase
        .from("chat_sessions")
        .select("id")
        .eq("user_id", userId)
        .eq("idempotency_key", tag)
        .is("deleted_at", null)
        .single();

      if (existing) {
        return NextResponse.json({
          sessionId: unscopedId(userId, existing.id),
          name,
          created: false,
        });
      }
    }

    const localId = crypto.randomBytes(8).toString("hex");
    const dbId = scopedId(userId, localId);

    // Support subtrack creation
    const isSubtrack = body.isSubtrack === true;
    const parentSessionId = body.parentSessionId as string | undefined;
    const forkMessageId = body.forkMessageId as string | undefined;

    const insertData: Record<string, unknown> = {
      id: dbId,
      user_id: userId,
      project_name: name,
      workspace_name: name,
      total_cost: 0,
      today_cost: 0,
      today_tokens_in: 0,
      today_tokens_out: 0,
      today_message_count: 0,
      today_date: new Date().toISOString().slice(0, 10),
      created_at: new Date().toISOString(),
    };

    if (idempotencyKey) {
      insertData.idempotency_key = `${userId}:idem:${idempotencyKey}`;
    }
    if (isSubtrack) {
      insertData.is_subtrack = true;
      if (parentSessionId) insertData.parent_session_id = scopedId(userId, parentSessionId);
      if (forkMessageId) insertData.fork_message_id = forkMessageId;
    }

    const { error } = await supabase.from("chat_sessions").insert(insertData);
    if (error) throw error;

    // Side effects (same as the old POST /api/sessions creation path):
    // 1. Analytics
    const { serverTrackSessionCreated } = await import("@/lib/analytics-server");
    serverTrackSessionCreated(userId, { sessionId: localId, projectName: name });

    // 2. Portal slug for non-subtracks
    if (!isSubtrack) {
      try {
        const { generatePortalSlug } = await import("@/lib/portal-slug");
        const slug = generatePortalSlug(name || "workspace");
        await supabase
          .from("chat_sessions")
          .update({ portal_slug: slug })
          .eq("id", dbId);
      } catch { /* non-critical */ }
    }

    return NextResponse.json({ sessionId: localId, name, created: true });
  } catch (err) {
    console.error("Failed to create workspace:", err);
    return NextResponse.json({ error: "Failed to create workspace" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify the endpoint works**

```bash
curl -s -X POST http://localhost:3000/api/workspaces \
  -H "Cookie: meter_session=<your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "test-workspace"}' | jq .
```

Expected: `{ "sessionId": "<hex-id>", "name": "test-workspace" }`

Verify the row exists in Supabase Dashboard → chat_sessions.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/workspaces/route.ts
git commit -m "feat: add POST /api/workspaces endpoint for server-minted workspace IDs"
```

---

## Task 2: Create `PATCH` and `DELETE /api/workspaces/[id]` endpoint

**Files:**
- Create: `src/app/api/workspaces/[id]/route.ts`

- [ ] **Step 1: Create the workspace mutation route**

```typescript
// src/app/api/workspaces/[id]/route.ts
import { NextRequest, NextResponse } from "next/server";
import { getSupabaseServer } from "@/lib/supabase";
import { requireAuth } from "@/lib/auth";

function scopedId(userId: string, localId: string): string {
  if (localId.startsWith(`${userId}:`)) return localId;
  return `${userId}:${localId}`;
}

// PATCH /api/workspaces/:id — rename, archive, or update a workspace
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;
  const { id } = await params;

  try {
    const body = await req.json();
    const supabase = getSupabaseServer();
    const dbId = scopedId(userId, id);

    const updates: Record<string, unknown> = {
      updated_at: new Date().toISOString(),
    };
    if (body.name != null) {
      updates.workspace_name = body.name;
      updates.project_name = body.name;
    }
    if (body.archived != null) updates.archived = body.archived;
    if (body.committed != null) updates.committed = body.committed;

    const { error } = await supabase
      .from("chat_sessions")
      .update(updates)
      .eq("id", dbId)
      .eq("user_id", userId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to update workspace:", err);
    return NextResponse.json({ error: "Failed to update workspace" }, { status: 500 });
  }
}

// DELETE /api/workspaces/:id — soft-delete a workspace
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await requireAuth();
  if (auth instanceof NextResponse) return auth;
  const { userId } = auth;
  const { id } = await params;

  try {
    const supabase = getSupabaseServer();
    const dbId = scopedId(userId, id);

    const { error } = await supabase
      .from("chat_sessions")
      .update({ deleted_at: new Date().toISOString() })
      .eq("id", dbId)
      .eq("user_id", userId);

    if (error) throw error;

    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Failed to delete workspace:", err);
    return NextResponse.json({ error: "Failed to delete workspace" }, { status: 500 });
  }
}
```

- [ ] **Step 2: Verify PATCH works**

```bash
curl -s -X PATCH http://localhost:3000/api/workspaces/<session-id> \
  -H "Cookie: meter_session=<your-session-token>" \
  -H "Content-Type: application/json" \
  -d '{"name": "renamed-workspace"}' | jq .
```

Expected: `{ "ok": true }`. Check Supabase Dashboard to confirm `workspace_name` changed.

- [ ] **Step 3: Commit**

```bash
git add src/app/api/workspaces/[id]/route.ts
git commit -m "feat: add PATCH/DELETE /api/workspaces/[id] for workspace mutations"
```

---

## Task 3: Update `workspace-store.ts` to use server-minted IDs

**Files:**
- Modify: `src/lib/workspace-store.ts` (lines 72-82)
- Modify: `src/lib/store.ts` (line 745-751, addSession)

- [ ] **Step 1: Make `createWorkspace` async and call the server**

In `src/lib/workspace-store.ts`, replace the `createWorkspace` function (lines 72-82):

```typescript
      // Add workspace AND activate it in a single set() — no cascading renders
      createWorkspace: (name: string, sessionId?: string) => {
        const id = generateId();
        const session = sessionId ?? `ws_${generateId()}`;
        emitLogEvent("workspace_created", getCurrentUserId());
        set((s) => ({
          workspaces: [...s.workspaces, { id, name, sessionId: session, createdAt: Date.now() }],
          activeWorkspaceId: id,
          activeTrackId: null,
        }));
        return id;
      },
```

With:

```typescript
      // Create workspace via server (canonical ID) and activate it.
      // If sessionId is provided (e.g. from server response), use it directly.
      // Otherwise call POST /api/workspaces to get a server-minted ID.
      createWorkspace: (name: string, sessionId?: string) => {
        const id = generateId(); // local workspace-store ID (not the session ID)
        const tempSessionId = sessionId ?? `pending_${generateId()}`;

        emitLogEvent("workspace_created", getCurrentUserId());

        // Optimistically add with temp session ID
        set((s) => ({
          workspaces: [...s.workspaces, { id, name, sessionId: tempSessionId, createdAt: Date.now() }],
          activeWorkspaceId: id,
          activeTrackId: null,
        }));

        // If no sessionId was provided, create on server and swap the ID
        if (!sessionId) {
          import("@/lib/auth-fetch").then(({ authFetch }) => {
            authFetch("/api/workspaces", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ name }),
            })
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (!data?.sessionId) return;
                // Swap temp session ID with server-minted canonical ID
                set((s) => ({
                  workspaces: s.workspaces.map((w) =>
                    w.id === id ? { ...w, sessionId: data.sessionId } : w
                  ),
                }));
                // Also create the session in the meter store with the canonical ID
                import("@/lib/store").then(({ useMeterStore }) => {
                  useMeterStore.getState().addSession(name, data.sessionId);
                });
              })
              .catch((err) => {
                console.error("[workspace] Failed to create on server:", err);
              });
          });
        }

        return id;
      },
```

- [ ] **Step 2: Verify workspace creation calls the server**

1. Open the app, create a new workspace via the UI
2. Check the Network tab — should see a POST to `/api/workspaces`
3. Check the Supabase Dashboard — the new session should have a server-minted ID (hex, not `ws_*`)
4. The workspace should be immediately usable (optimistic update)

- [ ] **Step 3: Commit**

```bash
git add src/lib/workspace-store.ts
git commit -m "feat: workspace creation calls server for canonical session IDs"
```

---

## Task 4: Add `idempotency_key` column to `chat_sessions`

**Files:**
- Modify: `src/app/api/setup-db/route.ts` (append to STATEMENTS)

The get-or-create semantic in Task 1 requires an `idempotency_key` column with a unique index. This ensures two devices creating the "default" workspace converge on one row.

- [ ] **Step 1: Add the column and index**

```typescript
  // Idempotency key for get-or-create workspace semantics.
  // Format: "{userId}:idem:{key}" — scoped per user.
  `alter table chat_sessions add column if not exists idempotency_key text`,
  `create unique index if not exists uq_chat_sessions_idem_key
   on chat_sessions (idempotency_key)
   where idempotency_key is not null`,
```

- [ ] **Step 2: Run setup-db to apply**

```bash
curl -s http://localhost:3000/api/setup-db \
  -H "Cookie: meter_session=<your-session-token>" | jq .
```

- [ ] **Step 3: Commit**

```bash
git add src/app/api/setup-db/route.ts
git commit -m "schema: add idempotency_key column to chat_sessions for get-or-create"
```

---

## Verification Checklist — Invariants

These verify the guarantees this PR must uphold, not just that endpoints exist.

- [ ] **One workspace per intended identity:** Call `POST /api/workspaces` with `idempotencyKey: "default"` twice from two different sessions (simulating two devices). Verify: only one `chat_sessions` row exists. Second call returns `created: false` with the same `sessionId`.
- [ ] **Server is the authority for IDs:** Create a workspace via UI. Check DB — `id` is a hex string (not `ws_*`). The workspace-store's `sessionId` matches the DB row.
- [ ] **Side effects preserved:** On creation, verify analytics event was tracked (`serverTrackSessionCreated` called) and `portal_slug` is populated on the DB row.
- [ ] **Mutations are server-authoritative:** Rename via `PATCH`, delete via `DELETE`. Verify DB state changes. Other devices will see these via Realtime in PR4 — for now, verify the DB is correct.
- [ ] **Backwards compatible:** Existing `ws_*` workspaces continue to load and function. The UI can switch to them and send messages.
