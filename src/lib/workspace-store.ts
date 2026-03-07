import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Workspace {
  id: string;
  name: string;
  sessionId?: string;
  createdAt: number;
}

export interface Track {
  id: string;
  workspaceId: string;
  name: string;
  createdAt: number;
  // Branching
  parentTrackId?: string;         // set on subtracks — points to the main/parent track
  forkMessageId?: string;         // last message ID before fork (shared history boundary)
  status?: "active" | "archived"; // archived = not chosen / closed
  isSubtrack?: boolean;           // true for forked subtracks
}

interface WorkspaceState {
  workspaces: Workspace[];
  tracks: Track[];
  activeWorkspaceId: string | null;
  activeTrackId: string | null;

  // Combined create+activate actions (single set call, no cascading renders)
  createWorkspace: (name: string, sessionId?: string) => string;
  renameWorkspace: (id: string, name: string) => void;
  deleteWorkspace: (id: string) => void;
  createTrack: (workspaceId: string, name: string) => string;
  setActiveWorkspace: (id: string) => void;
  setActiveTrack: (id: string | null) => void;
  upsertWorkspacesFromSessions: (
    sessions: Array<{ id: string; project_name?: string; name?: string; created_at?: string }>,
    activeSessionId?: string
  ) => void;

  // Branching actions
  forkTrack: (workspaceId: string, parentTrackId: string | null, forkMessageId: string, names: string[]) => string[];
  commitSubtrack: (subtrackId: string) => void;
  closeAllSubtracks: (parentTrackId: string | null) => void;
  getActiveSubtracks: (parentTrackId: string | null) => Track[];
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      workspaces: [],
      tracks: [],
      activeWorkspaceId: null,
      activeTrackId: null,

      // Add workspace AND activate it in a single set() — no cascading renders
      createWorkspace: (name: string, sessionId?: string) => {
        const id = generateId();
        const session = sessionId ?? `ws_${generateId()}`;
        set((s) => ({
          workspaces: [...s.workspaces, { id, name, sessionId: session, createdAt: Date.now() }],
          activeWorkspaceId: id,
          activeTrackId: null,
        }));
        return id;
      },

      renameWorkspace: (id: string, name: string) => {
        const workspace = get().workspaces.find((w) => w.id === id);
        set((s) => ({
          workspaces: s.workspaces.map((w) =>
            w.id === id ? { ...w, name } : w
          ),
        }));
        // Sync renamed workspace name to the meter store session so it
        // persists to the server on the next session sync.
        if (workspace?.sessionId) {
          // Lazy import to avoid circular dependency
          import("@/lib/store").then(({ useMeterStore }) => {
            useMeterStore.setState((s) => ({
              sessions: s.sessions.map((sess) =>
                sess.id === workspace.sessionId ? { ...sess, name } : sess
              ),
            }));
          });
        }
      },

      deleteWorkspace: (id: string) => {
        set((s) => {
          const workspaces = s.workspaces.filter((w) => w.id !== id);
          const tracks = s.tracks.filter((t) => t.workspaceId !== id);
          const activeWorkspaceId = s.activeWorkspaceId === id
            ? workspaces[0]?.id ?? null
            : s.activeWorkspaceId;
          const activeTrackId = s.activeWorkspaceId === id ? null : s.activeTrackId;
          return { workspaces, tracks, activeWorkspaceId, activeTrackId };
        });
      },

      // Add track AND activate it in a single set()
      createTrack: (workspaceId: string, name: string) => {
        const id = generateId();
        set((s) => ({
          tracks: [...s.tracks, { id, workspaceId, name, createdAt: Date.now() }],
          activeTrackId: id,
        }));
        return id;
      },

      setActiveWorkspace: (id: string) => {
        set({ activeWorkspaceId: id, activeTrackId: null });
      },

      setActiveTrack: (id: string | null) => {
        set({ activeTrackId: id });
      },

      // --- Branching actions ---

      forkTrack: (workspaceId: string, parentTrackId: string | null, forkMessageId: string, names: string[]) => {
        const ids: string[] = [];
        const now = Date.now();
        const newTracks: Track[] = names.map((name) => {
          const id = generateId();
          ids.push(id);
          return {
            id,
            workspaceId,
            name,
            createdAt: now,
            parentTrackId: parentTrackId ?? undefined,
            forkMessageId,
            status: "active" as const,
            isSubtrack: true,
          };
        });
        set((s) => ({
          tracks: [...s.tracks, ...newTracks],
          // Stay on main — don't auto-jump to first path.
          // FrozenMainBanner will appear so user can choose which path to enter.
        }));
        return ids;
      },

      commitSubtrack: (subtrackId: string) => {
        set((s) => {
          const subtrack = s.tracks.find((t) => t.id === subtrackId);
          if (!subtrack || !subtrack.isSubtrack) return s;
          const parentId = subtrack.parentTrackId ?? null;
          // Archive all sibling subtracks (including the committed one)
          const tracks = s.tracks.map((t) => {
            if (t.isSubtrack && (t.parentTrackId ?? null) === parentId) {
              return { ...t, status: "archived" as const };
            }
            return t;
          });
          return { tracks, activeTrackId: parentId };
        });
      },

      closeAllSubtracks: (parentTrackId: string | null) => {
        set((s) => {
          const tracks = s.tracks.map((t) => {
            if (t.isSubtrack && (t.parentTrackId ?? null) === parentTrackId && t.status === "active") {
              return { ...t, status: "archived" as const };
            }
            return t;
          });
          return { tracks, activeTrackId: parentTrackId };
        });
      },

      getActiveSubtracks: (parentTrackId: string | null): Track[] => {
        return get().tracks.filter(
          (t: Track) => t.isSubtrack && (t.parentTrackId ?? null) === parentTrackId && t.status === "active"
        );
      },

      upsertWorkspacesFromSessions: (sessions, activeSessionId) => {
        if (!sessions || sessions.length === 0) return;
        set((s) => {
          const workspaces = [...s.workspaces];
          const norm = (v: string) => v.toLowerCase();

          // Skip sessions that correspond to subtracks — they're tracks, not workspaces
          const subtrackSessionIds = new Set(
            s.tracks.filter((t) => t.isSubtrack).map((t) => t.id)
          );

          for (const session of sessions) {
            if (subtrackSessionIds.has(session.id)) continue;
            const sessionId = session.id;
            const name = session.project_name ?? session.name ?? session.id;
            const createdAtRaw = session.created_at ? Date.parse(session.created_at) : NaN;
            const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();

            let idx = workspaces.findIndex((w) => w.sessionId === sessionId);
            if (idx === -1) {
              idx = workspaces.findIndex(
                (w) => !w.sessionId && norm(w.name) === norm(name)
              );
            }

            if (idx === -1) {
              workspaces.push({
                id: generateId(),
                name,
                sessionId,
                createdAt,
              });
            } else {
              const existing = workspaces[idx];
              workspaces[idx] = {
                ...existing,
                // Keep locally renamed name — only use server name if no local name exists
                name: existing.name || name,
                sessionId: existing.sessionId ?? sessionId,
              };
            }
          }

          let activeWorkspaceId = s.activeWorkspaceId;
          if (activeSessionId) {
            const active = workspaces.find((w) => w.sessionId === activeSessionId);
            if (active) activeWorkspaceId = active.id;
          }
          if (!activeWorkspaceId && workspaces.length > 0) {
            activeWorkspaceId = workspaces[0].id;
          }

          return { workspaces, activeWorkspaceId };
        });
      },
    }),
    {
      name: "workspace-store-v1",
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        workspaces: s.workspaces,
        tracks: s.tracks,
        activeWorkspaceId: s.activeWorkspaceId,
        activeTrackId: s.activeTrackId,
      }),
      // Migrate old localStorage shape (companies/projects) → new (workspaces/tracks)
      migrate: (persisted: unknown, version: number) => {
        const state = persisted as Record<string, unknown>;
        if (version < 2) {
          // Rename companies → workspaces
          if (state.companies && !state.workspaces) {
            state.workspaces = state.companies;
            delete state.companies;
          }
          // Rename activeCompanyId → activeWorkspaceId
          if (state.activeCompanyId !== undefined && state.activeWorkspaceId === undefined) {
            state.activeWorkspaceId = state.activeCompanyId;
            delete state.activeCompanyId;
          }
          // Rename projects → tracks, companyId → workspaceId
          const tracks = (state.tracks || state.projects || []) as Record<string, unknown>[];
          state.tracks = tracks.map((t) => ({
            ...t,
            workspaceId: t.workspaceId || t.companyId,
          }));
          delete state.projects;
          // Rename activeProjectId → activeTrackId
          if (state.activeProjectId !== undefined && state.activeTrackId === undefined) {
            state.activeTrackId = state.activeProjectId;
            delete state.activeProjectId;
          }
        }
        return state as WorkspaceState;
      },
    }
  )
);

/**
 * Resolve a potentially-subtrack track ID to its parent workspace session ID.
 * If the given ID belongs to a subtrack, returns the parent workspace's sessionId
 * (which is the meter-store session ID for the workspace). Otherwise returns the
 * original ID unchanged.
 */
export function resolveWorkspaceSessionId(sessionId: string | null): string | null {
  if (!sessionId) return null;
  const state = useWorkspaceStore.getState();
  const track = state.tracks.find((t) => t.id === sessionId);
  if (track?.isSubtrack) {
    const workspace = state.workspaces.find((w) => w.id === track.workspaceId);
    if (workspace?.sessionId) return workspace.sessionId;
  }
  return sessionId;
}
