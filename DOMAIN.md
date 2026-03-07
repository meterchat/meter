# Meter Domain Model Reference

> This file documents the hierarchy, relationships, and database design decisions.

## Core Principle

**A workspace IS a chat session.** That is its DNA. When a user creates a workspace,
we create a `chat_sessions` row. Everything — messages, decisions, documents, connectors,
spend limits, billing — hangs off that session. Tracks (forks) are child sessions
(`is_subtrack = true`) that point back to the parent workspace session.

## Hierarchy

```
Account (meter_users — passkey auth, Stripe customer, card info)
  └── Workspace = chat_sessions row (is_subtrack = false)
        ├── Messages (chat_messages, scoped by session_id)
        ├── Tracks (child chat_sessions rows, is_subtrack = true, parent_session_id → workspace)
        ├── Decisions (decisions.session_id → workspace session)
        ├── Connectors (oauth_tokens.workspace_id → workspace session)
        ├── Documents (artifacts.session_id → workspace session)
        ├── Spend Limits (columns on the chat_sessions row: daily_limit, monthly_limit, per_txn_limit)
        ├── Cost Tracking (columns: total_cost, today_cost, week_cost, month_cost)
        └── Settlement (settlement_history.workspace_id → workspace session)
```

**Account-level (not workspace-scoped):** Stripe customer ID, card info, account type,
markup multiplier. One card covers all workspaces.

## Workspace Store (`src/lib/workspace-store.ts`)

| Name | Purpose |
|------|---------|
| `Workspace` interface | A user's container — could be a company, product, or project |
| `Track` interface | A conversation path within a workspace. Main track or forked path |
| `workspaces[]` | Array of all workspaces |
| `tracks[]` | Array of all tracks across workspaces |
| `activeWorkspaceId` | Currently selected workspace |
| `activeTrackId` | Currently selected track (null = main) |
| `forkTrack()` | Fork main into parallel paths |
| `commitSubtrack()` | Merge chosen path into main |
| `closeAllSubtracks()` | Archive all forked paths |

## Main Store (`src/lib/store.ts`)

| Name | Purpose |
|------|---------|
| `Session` interface | Chat data container — messages, costs, streaming state |
| `sessions[]` | Array of all sessions (one per workspace + one per subtrack) |
| `activeSessionId` | The currently active session |
| `addSession()` | Create a new session |
| `createSubtrackSession()` | Copy messages into a new session for a forked path |
| `mergeSubtrackIntoParent()` | Append path messages back into main session |

## Components

| Name | File |
|------|------|
| `WorkspaceSwitcher` | `workspace-switcher.tsx` |
| `TrackSwitcher` | `track-switcher.tsx` |
| `WorkspaceBar` | `workspace-bar.tsx` |

## Database Design

**`chat_sessions` is the source of truth.** Workspaces and tracks are both stored as
`chat_sessions` rows, distinguished by `is_subtrack`. Two Postgres **views** project
them into self-documenting shapes:

- **`workspaces` view** — `SELECT ... FROM chat_sessions WHERE is_subtrack = false`
- **`tracks` view** — `SELECT ... FROM chat_sessions WHERE is_subtrack = true`

These views exist so any agent or human looking at the DB immediately understands the
domain model. They are read-only projections; all writes go to `chat_sessions`.

| DB Table / Column | What It Represents |
|---|---|
| `workspaces` (view) | All workspaces (derived from chat_sessions) |
| `tracks` (view) | All tracks/forks (derived from chat_sessions) |
| `chat_sessions` (is_subtrack=false) | Workspace (source row) |
| `chat_sessions` (is_subtrack=true) | Track / fork (source row) |
| `chat_sessions.workspace_name` | Display name of the workspace |
| `chat_sessions.project_name` | Legacy alias for workspace name |
| `chat_sessions.daily_limit` etc. | Per-workspace spend limits |
| `chat_messages.session_id` | Messages scoped to a workspace or track |
| `decisions.session_id` | Decision scoped to a workspace |
| `artifacts.session_id` | Document scoped to a workspace |
| `oauth_tokens.workspace_id` | Connector scoped to a workspace (= chat_sessions.id) |
| `settlement_history.workspace_id` | Settlement scoped to a workspace (= chat_sessions.id) |
| `decisions.project_id` | Legacy alias for session_id |
| `artifacts.project_id` | Legacy alias for session_id |

## UI Labels (what users see)

| UI Term | Domain Concept |
|---------|---------------|
| "Workspace" | Workspace |
| "Main" | Main track (default) |
| "Paths" | Tracks / forked paths |
| "Explore paths" | Create parallel tracks from main |
| "Commit to this path" | Merge forked track into main |

## Key Relationships

- A **Workspace** IS a `chat_sessions` row with `is_subtrack = false`
- A **Track** IS a `chat_sessions` row with `is_subtrack = true` and `parent_session_id` set
- Each workspace has one perpetual conversation (the main track) plus zero or more forked tracks
- **Connectors**, **Decisions**, **Artifacts**, and **Settlement** all reference the workspace
  session ID (via `workspace_id` or `session_id` columns)
- **Card/Stripe** info is account-level (`meter_users`), not workspace-level
