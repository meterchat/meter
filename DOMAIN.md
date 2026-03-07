# Meter Domain Model Reference

> Code names now match domain concepts. This file documents the hierarchy,
> relationships, and any remaining legacy naming in the database layer.

## Hierarchy

```
Account (user identity, passkey auth via meter_users)
  └── Workspace (a company, product, project, or thought — user decides)
        ├── Main Track (default perpetual chat session)
        ├── Forked Tracks (temporary parallel explorations)
        ├── Decisions (structured records from debates)
        ├── Connectors (GitHub, Stripe, Gmail, etc.)
        ├── Documents / Artifacts
        └── Billing (tokens consumed, receipts, settle, spend limits)
```

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

## Database (Legacy Naming)

The database columns use legacy names that don't match the TypeScript layer.
This is intentional — renaming SQL columns would require a migration and is not needed.

| DB Name | Actual Concept |
|---------|---------------|
| `project_id` column | Session ID (in decisions, artifacts tables) |
| `project_name` column | Session name (in chat_sessions table) |
| `workspace_id` column | Workspace ID (in billing, oauth, settlement tables) |
| `workspace_projects` table | Workspace-Track links (not actively used) |

## UI Labels (what users see)

| UI Term | Domain Concept |
|---------|---------------|
| "Workspace" | Workspace |
| "Main" | Main track (default) |
| "Paths" | Tracks / forked paths |
| "Explore paths" | Create parallel tracks from main |
| "Commit to this path" | Merge forked track into main |

## Key Relationships

- Each **Workspace** has exactly one **main session** (perpetual chat)
- Each **Workspace** can have zero or more **subtracks** (forked paths)
- Each **subtrack** has its own **session** (forked from main's messages at fork point)
- **Connectors** are scoped per workspace
- **Decisions** and **Artifacts** reference sessions via `project_id` (legacy DB column name)
- **Billing** (spend limits, settlement) is scoped per workspace via `workspace_id`
