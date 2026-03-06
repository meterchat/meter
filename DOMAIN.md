# Meter Domain Model Reference

> This file maps code-level names to their actual domain concepts.
> The codebase uses legacy names (Company, Project) that don't match the product model.
> Use this reference to avoid confusion when reading or writing code.

## Hierarchy

```
Account (user identity, passkey auth)
  └── Workspace (a company, product, project, or thought — user decides)
        ├── Main Track (default perpetual chat)
        ├── Forked Paths (temporary parallel explorations)
        ├── Decisions (structured records from debates)
        ├── Connectors (GitHub, Stripe, Gmail, etc.)
        ├── Documents / Artifacts
        └── Billing (tokens consumed, receipts, settle, spend limits)
```

## Code-to-Domain Mapping

### Workspace Store (`src/lib/workspace-store.ts`)

| Code Name | Domain Concept | Notes |
|-----------|---------------|-------|
| `Company` interface | **Workspace** | A user's container — could be a company, product, or project |
| `Project` interface | **Track** | A conversation path within a workspace. Main track or forked path |
| `companies[]` | **workspaces** | Array of all workspaces |
| `projects[]` | **tracks** | Array of all tracks across workspaces |
| `companyId` (on Project) | **workspaceId** | Links a track to its parent workspace |
| `activeCompanyId` | **activeWorkspaceId** | Currently selected workspace |
| `activeProjectId` | **activeTrackId** | Currently selected track (null = main) |
| `createCompany()` | **createWorkspace()** | Create a new workspace |
| `renameCompany()` | **renameWorkspace()** | Rename a workspace |
| `deleteCompany()` | **deleteWorkspace()** | Delete a workspace and all its tracks |
| `createProject()` | **createTrack()** | Create a new track in a workspace |
| `setActiveCompany()` | **setActiveWorkspace()** | Switch active workspace |
| `setActiveProject()` | **setActiveTrack()** | Switch active track |
| `upsertCompaniesFromSessions()` | **upsertWorkspacesFromSessions()** | Sync workspaces from server sessions |
| `forkTrack()` | **forkTrack()** | Fork main into parallel paths (name is correct) |
| `commitSubtrack()` | **commitSubtrack()** | Merge chosen path into main (name is correct) |
| `closeAllSubtracks()` | **closeAllSubtracks()** | Archive all forked paths (name is correct) |
| `isSubtrack` | **isSubtrack** | True for forked paths (not the main track) |
| `parentTrackId` | **parentTrackId** | Points to the main track this path branched from |
| `forkMessageId` | **forkMessageId** | The message where the fork happened |

### Main Store (`src/lib/store.ts`)

| Code Name | Domain Concept | Notes |
|-----------|---------------|-------|
| `ProjectThread` interface | **Session** | Chat data container — messages, costs, streaming state |
| `projects[]` | **sessions** | Array of all sessions (one per workspace + one per subtrack) |
| `activeProjectId` | **activeSessionId** | The currently active session |
| `addProject()` | **addSession()** | Create a new session |
| `renameProject()` | **renameSession()** | Rename a session |
| `removeProject()` | **removeSession()** | Remove a session |
| `setActiveProject()` | **setActiveSession()** | Switch active session |
| `createSubtrackThread()` | **createSubtrackThread()** | Copy messages into a new session for a forked path |
| `mergeSubtrackIntoParent()` | **mergeSubtrackIntoParent()** | Append path messages back into main session |

### Components

| Code Name | Domain Concept | File |
|-----------|---------------|------|
| `CompanySwitcher` | **WorkspaceSwitcher** | `company-switcher.tsx` |
| `ProjectSwitcher` | **TrackSwitcher** | `project-switcher.tsx` |
| `WorkspaceBar` | **WorkspaceBar** | `workspace-bar.tsx` (correct) |

### API / Database

| Code Name | Domain Concept | Notes |
|-----------|---------------|-------|
| `/api/sessions` | Session sync | Syncs sessions to server |
| `project_id` (DB column) | Session ID | Used in decisions, artifacts tables — legacy name |
| `workspace_id` (DB column) | Workspace ID | Used in billing, oauth, settlement tables |
| `workspace_projects` (DB table) | Workspace-Track links | Links workspaces to their tracks — legacy name |

### UI Labels (what users see)

| UI Term | Domain Concept |
|---------|---------------|
| "Workspace" | Workspace |
| "Main" | Main track (default) |
| "Paths" | Tracks / forked paths |
| "Fork into paths" | Create parallel tracks from main |
| "Commit to this path" | Merge forked track into main |
| "Close all paths" | Archive all forked tracks, unfreeze main |

## Key Relationships

- Each **Workspace** has exactly one **main session** (perpetual chat)
- Each **Workspace** can have zero or more **subtracks** (forked paths)
- Each **subtrack** has its own **session** (forked from main's messages at fork point)
- **Connectors** are scoped per workspace
- **Decisions** and **Artifacts** reference sessions via `project_id` (legacy DB column name)
- **Billing** (spend limits, settlement) is scoped per workspace via `workspace_id`
