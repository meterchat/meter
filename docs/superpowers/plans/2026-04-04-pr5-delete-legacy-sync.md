# PR5: Delete Legacy Sync + Fix Subtracks — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the entire legacy sync infrastructure (`useSessionSync`, `POST /api/sessions`, `/api/chat/resume`, sendBeacon handlers, logout sync) and fix subtracks to stop cloning parent messages.

**Architecture:** With Realtime subscriptions (PR4) handling all read-path updates, the old write-sync layer is dead code. This PR deletes it. Logout becomes trivial (clear local state). Subtracks are fixed to compose parent+subtrack messages at render time instead of cloning.

**Tech Stack:** File deletions, Zustand store simplification, subtrack render composition.

**Spec:** `docs/superpowers/specs/2026-04-04-server-authoritative-state-design.md` — Section 5

**Depends on:** PR4 (Realtime subscriptions) must be deployed and stable.

---

## File Structure

| File | Action | Responsibility |
|------|--------|----------------|
| `src/lib/use-session-sync.ts` | Delete | Entire file — replaced by `use-realtime-sync.ts` |
| `src/app/api/chat/resume/route.ts` | Delete | Replaced by Realtime subscriptions |
| `src/app/api/sessions/route.ts` | Modify | Delete POST handler, keep GET (bootstrap) and DELETE |
| `src/lib/store.ts` | Modify | Simplify logout, fix createSubtrackSession |

---

## Task 1: Delete `use-session-sync.ts`

**Files:**
- Delete: `src/lib/use-session-sync.ts`

- [ ] **Step 1: Verify no remaining imports**

Search for imports of `useSessionSync` or `use-session-sync`:

```bash
cd /Users/osamaaamer/conductor/workspaces/meter/berlin && grep -r "use-session-sync\|useSessionSync" src/ --include="*.ts" --include="*.tsx" -l
```

If any files still import it (besides the file itself), update them to use `useRealtimeSync` instead (should have been done in PR4, but verify).

Also check for `requestImmediateSync` which is exported from this file:

```bash
grep -r "requestImmediateSync" src/ --include="*.ts" --include="*.tsx" -l
```

Remove any remaining calls to `requestImmediateSync` — they are no longer needed since the server writes directly.

- [ ] **Step 2: Delete the file**

```bash
rm src/lib/use-session-sync.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete use-session-sync.ts (replaced by use-realtime-sync.ts)"
```

---

## Task 2: Delete `/api/chat/resume` endpoint

**Files:**
- Delete: `src/app/api/chat/resume/route.ts`

- [ ] **Step 1: Verify no remaining references**

```bash
grep -r "chat/resume\|api/chat/resume" src/ --include="*.ts" --include="*.tsx" -l
```

Remove any remaining references (should be none after PR4 replaced the reconnect logic).

- [ ] **Step 2: Delete the file**

```bash
rm src/app/api/chat/resume/route.ts
```

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: delete /api/chat/resume (replaced by Realtime subscriptions)"
```

---

## Task 3: Remove POST handler from `/api/sessions`

**Files:**
- Modify: `src/app/api/sessions/route.ts`

- [ ] **Step 1: Delete the POST function**

In `src/app/api/sessions/route.ts`, delete the entire `POST` export function (lines 152-296). Keep `GET` (used for bootstrap) and `DELETE` (used for workspace deletion).

- [ ] **Step 2: Commit**

```bash
git add src/app/api/sessions/route.ts
git commit -m "chore: remove POST /api/sessions (sync endpoint no longer needed)"
```

---

## Task 4: Simplify logout

**Files:**
- Modify: `src/lib/store.ts` (lines 627-742)

- [ ] **Step 1: Replace the logout function**

Replace the entire `logout` action (lines 627-742) with:

```typescript
      logout: async () => {
        set({ loggingOut: true });

        // Tear down Realtime subscriptions
        try {
          const { destroyRealtimeClient } = await import("@/lib/supabase-realtime");
          destroyRealtimeClient();
        } catch { /* module not loaded */ }

        // Fire-and-forget server-side session cleanup
        authFetch("/api/auth/logout", { method: "POST" }).catch(() => {});

        // Clear this store — everything is already in the DB
        set({
          userId: null,
          handle: null,
          email: null,
          authenticated: false,
          sessionsLoaded: false,
          cardOnFile: false,
          cardLast4: null,
          cardBrand: null,
          stripeCustomerId: null,
          creditBalance: 0,
          sessions: initialSessions,
          activeSessionId: "default",
          inspectorOpen: false,
          loggingOut: false,
          pendingCharges: [],
          isSettling: false,
          cards: [],
          settlementHistory: [],
          spendLimits: { dailyLimit: null, monthlyLimit: null, perTxnLimit: null },
        });

        // Clear workspace store
        useWorkspaceStore.setState({
          workspaces: [],
          tracks: [],
          activeWorkspaceId: null,
          activeTrackId: null,
        });

        // Clear decisions store
        useDecisionsStore.setState({
          decisions: [],
          panelOpen: false,
          filter: "all",
        });

        // Clear staging store
        useStagingStore.getState().clearStaged();

        // Remove persisted localStorage for other stores + drafts
        if (typeof window !== "undefined") {
          localStorage.removeItem("workspace-store-v1");
          localStorage.removeItem("decisions-store-v1");
          const keysToRemove: string[] = [];
          for (let i = 0; i < localStorage.length; i++) {
            const key = localStorage.key(i);
            if (key?.startsWith("meter:draft:")) keysToRemove.push(key);
          }
          keysToRemove.forEach((k) => localStorage.removeItem(k));
        }
      },
```

The key difference: no `syncPromises`, no `sendBeacon` fallback, no 3-second timeout race. Everything is already in the DB.

- [ ] **Step 2: Commit**

```bash
git add src/lib/store.ts
git commit -m "feat: simplify logout — just clear local state, no sync needed"
```

---

## Task 5: Fix `createSubtrackSession` to stop cloning parent messages

**Files:**
- Modify: `src/lib/store.ts` (lines 1736-1777)

- [ ] **Step 1: Replace createSubtrackSession**

Replace the current implementation (lines 1736-1777) with one that does NOT clone parent messages:

```typescript
      createSubtrackSession: (subtrackId: string, parentSessionId: string, forkMessageId: string) => {
        set((s) => {
          const existing = s.sessions.find((p) => p.id === subtrackId);
          if (existing && existing.messages.length > 0) return s;

          const parent = s.sessions.find((p) => p.id === parentSessionId);
          if (!parent) return s;

          const forkIdx = parent.messages.findIndex((m) => m.id === forkMessageId);
          if (forkIdx === -1) return s;

          // Mark the fork point on the parent thread
          const updatedParent = {
            ...parent,
            messages: parent.messages.map((m) =>
              m.id === forkMessageId ? { ...m, isForkPoint: true } : m
            ),
          };

          // Create subtrack session with NO messages (empty).
          // The UI composes the view at render time:
          //   parent messages up to fork point + subtrack's own messages.
          // This eliminates the bug where cloned message IDs conflict
          // with the parent session during sync/upsert.
          const subSession = existing ?? createSession(subtrackId, `Branch from ${parent.name}`);

          return {
            sessions: s.sessions
              .map((p) => (p.id === parentSessionId ? updatedParent : p))
              .filter((p) => p.id !== subtrackId)
              .concat([subSession]),
          };
        });
      },
```

- [ ] **Step 2: Add `getComposedMessages` selector to store**

This is a cross-cutting change. Once subtracks stop cloning parent messages, EVERY consumer of `session.messages` that expects the full history becomes suspect. Instead of fixing each consumer individually, add a single selector that composes the view.

In `src/lib/store.ts`, add a new exported selector:

```typescript
/**
 * Get the composed message list for a session. For subtracks, this
 * prepends the parent's messages up to the fork point. For regular
 * sessions, returns session.messages as-is. ALL consumers of session
 * messages should use this selector instead of reading session.messages
 * directly — rendering, pagination, export, settlement, search, counters.
 */
export function getComposedMessages(
  sessions: Session[],
  sessionId: string,
  tracks: { id: string; isSubtrack?: boolean; workspaceId?: string; forkMessageId?: string }[],
  workspaces: { id: string; sessionId?: string }[],
): ChatMessage[] {
  const session = sessions.find((s) => s.id === sessionId);
  if (!session) return [];

  const track = tracks.find((t) => t.id === sessionId && t.isSubtrack);
  if (!track?.forkMessageId) return session.messages;

  const parentWs = workspaces.find((w) => w.id === track.workspaceId);
  if (!parentWs?.sessionId) return session.messages;

  const parent = sessions.find((s) => s.id === parentWs.sessionId);
  if (!parent) return session.messages;

  const forkIdx = parent.messages.findIndex((m) => m.id === track.forkMessageId);
  if (forkIdx === -1) return session.messages;

  const preFork = parent.messages.slice(0, forkIdx + 1);
  return [...preFork, ...session.messages];
}
```

- [ ] **Step 3: Audit and update all `session.messages` consumers**

Run:

```bash
grep -rn "\.messages" src/components/ src/lib/ --include="*.ts" --include="*.tsx" | grep -v node_modules | grep -v "\.messages\." | head -40
```

Key consumers to update (replace `session.messages` with `getComposedMessages(...)`:
- **Message list rendering** — the chat view component that maps over messages
- **`fetchOlderMessages`** — pagination: needs to know which messages belong to the subtrack vs parent
- **`getUnsettledMessages`** — settlement: should only count the subtrack's own messages, not parent's
- **`getPendingBalance`** — same as settlement
- **Any export/search** — if messages are exported or searched, must include composed view

For each consumer, determine whether it needs the **composed** view (rendering, export) or the **raw** view (sync, settlement for this session only). Document the decision in a comment.

- [ ] **Step 3: Commit**

```bash
git add src/lib/store.ts src/components/
git commit -m "fix: subtracks no longer clone parent messages — compose at render time"
```

---

## Task 6: Clean up remaining references

- [ ] **Step 1: Search for dead references**

```bash
grep -r "syncToServer\|sendBeacon\|syncedMessageCount\|lastSyncRef\|requestImmediateSync\|meter:was-streaming" src/ --include="*.ts" --include="*.tsx" -l
```

Remove any remaining references to the old sync infrastructure.

- [ ] **Step 2: Remove sendBeacon/beforeunload handlers if any remain**

These should all be gone with `use-session-sync.ts`, but check `store.ts` and any other files.

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore: remove remaining references to legacy sync infrastructure"
```

---

## Verification Checklist — Invariants

- [ ] **No data loss on logout:** Logout. Login. Verify ALL messages from ALL sessions are present (loaded from server bootstrap). Count messages before logout vs after login — must match.
- [ ] **No data loss on refresh:** Refresh the page. All messages present. No "loading" state longer than 1 second. Cost counters match pre-refresh values.
- [ ] **Subtracks don't steal messages from main:** Create a subtrack, send messages in it. Switch back to main workspace. Verify main workspace's messages are intact. Check DB: subtrack's `chat_messages` rows have only post-fork messages (not duplicates of parent messages).
- [ ] **Composed view is correct:** In a subtrack, verify the message list shows: parent messages up to fork point + subtrack's own messages. The fork point message appears once (not duplicated).
- [ ] **Settlement only counts session's own messages:** In a subtrack, verify `getUnsettledMessages()` returns only the subtrack's messages, not the parent's.
- [ ] **No dead code remains:** `grep -r "syncToServer\|sendBeacon\|syncedMessageCount\|requestImmediateSync\|meter:was-streaming\|use-session-sync\|chat/resume" src/ --include="*.ts" --include="*.tsx"` returns zero results.
- [ ] **End-to-end flow:** Send message on phone → see on desktop → refresh desktop → message still there → logout on phone → login on phone → all messages present → create subtrack on desktop → see on phone via Realtime.
