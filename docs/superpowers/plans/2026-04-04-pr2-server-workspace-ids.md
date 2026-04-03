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

// POST /api/workspaces — create a new workspace (server-minted ID)
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
    const localId = crypto.randomBytes(8).toString("hex");
    const dbId = scopedId(userId, localId);

    const { error } = await supabase.from("chat_sessions").insert({
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
    });

    if (error) throw error;

    return NextResponse.json({ sessionId: localId, name });
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

## Task 4: Handle subtrack creation via server

**Files:**
- Modify: `src/app/api/workspaces/route.ts` (add subtrack support to POST)

- [ ] **Step 1: Add subtrack support to POST /api/workspaces**

In `src/app/api/workspaces/route.ts`, update the POST handler to accept subtrack params. Add these lines after the initial insert block, before the return:

```typescript
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

    if (isSubtrack) {
      insertData.is_subtrack = true;
      if (parentSessionId) insertData.parent_session_id = scopedId(userId, parentSessionId);
      if (forkMessageId) insertData.fork_message_id = forkMessageId;
    }

    const { error } = await supabase.from("chat_sessions").insert(insertData);
```

Replace the existing insert block with this expanded version.

- [ ] **Step 2: Commit**

```bash
git add src/app/api/workspaces/route.ts
git commit -m "feat: support subtrack creation in POST /api/workspaces"
```

---

## Verification Checklist

- [ ] Creating a workspace from the UI calls `POST /api/workspaces` and gets a server-minted ID
- [ ] The new workspace appears in the Supabase `chat_sessions` table with a hex ID (not `ws_*`)
- [ ] Renaming a workspace calls `PATCH /api/workspaces/:id` and updates the DB
- [ ] Deleting a workspace calls `DELETE /api/workspaces/:id` and soft-deletes
- [ ] Existing `ws_*` workspaces continue to work (backwards compatible)
- [ ] Creating the same workspace on two devices yields one canonical server record (verify by checking DB after creating on both)
