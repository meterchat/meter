import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";

export interface Company {
  id: string;
  name: string;
  sessionId?: string;
  createdAt: number;
}

export interface Project {
  id: string;
  companyId: string;
  name: string;
  createdAt: number;
  // Branching
  parentTrackId?: string;         // set on subtracks — points to the main/parent track
  forkMessageId?: string;         // last message ID before fork (shared history boundary)
  status?: "active" | "archived"; // archived = not chosen / closed
  isSubtrack?: boolean;           // true for forked subtracks
}

interface WorkspaceState {
  companies: Company[];
  projects: Project[];
  activeCompanyId: string | null;
  activeProjectId: string | null;

  // Combined create+activate actions (single set call, no cascading renders)
  createCompany: (name: string, sessionId?: string) => string;
  renameCompany: (id: string, name: string) => void;
  deleteCompany: (id: string) => void;
  createProject: (companyId: string, name: string) => string;
  setActiveCompany: (id: string) => void;
  setActiveProject: (id: string | null) => void;
  upsertCompaniesFromSessions: (
    sessions: Array<{ id: string; project_name?: string; name?: string; created_at?: string }>,
    activeSessionId?: string
  ) => void;

  // Branching actions
  forkTrack: (companyId: string, parentTrackId: string | null, forkMessageId: string, names: string[]) => string[];
  commitSubtrack: (subtrackId: string) => void;
  closeAllSubtracks: (parentTrackId: string | null) => void;
  getActiveSubtracks: (parentTrackId: string | null) => Project[];
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set, get) => ({
      companies: [],
      projects: [],
      activeCompanyId: null,
      activeProjectId: null,

      // Add company AND activate it in a single set() — no cascading renders
      createCompany: (name: string, sessionId?: string) => {
        const id = generateId();
        const session = sessionId ?? `ws_${generateId()}`;
        set((s) => ({
          companies: [...s.companies, { id, name, sessionId: session, createdAt: Date.now() }],
          activeCompanyId: id,
          activeProjectId: null,
        }));
        return id;
      },

      renameCompany: (id: string, name: string) => {
        const company = get().companies.find((c) => c.id === id);
        set((s) => ({
          companies: s.companies.map((c) =>
            c.id === id ? { ...c, name } : c
          ),
        }));
        // Sync renamed workspace name to the meter store project so it
        // persists to the server on the next session sync.
        if (company?.sessionId) {
          // Lazy import to avoid circular dependency
          import("@/lib/store").then(({ useMeterStore }) => {
            useMeterStore.setState((s) => ({
              projects: s.projects.map((p) =>
                p.id === company.sessionId ? { ...p, name } : p
              ),
            }));
          });
        }
      },

      deleteCompany: (id: string) => {
        set((s) => {
          const companies = s.companies.filter((c) => c.id !== id);
          const projects = s.projects.filter((p) => p.companyId !== id);
          const activeCompanyId = s.activeCompanyId === id
            ? companies[0]?.id ?? null
            : s.activeCompanyId;
          const activeProjectId = s.activeCompanyId === id ? null : s.activeProjectId;
          return { companies, projects, activeCompanyId, activeProjectId };
        });
      },

      // Add project AND activate it in a single set()
      createProject: (companyId: string, name: string) => {
        const id = generateId();
        set((s) => ({
          projects: [...s.projects, { id, companyId, name, createdAt: Date.now() }],
          activeProjectId: id,
        }));
        return id;
      },

      setActiveCompany: (id: string) => {
        set({ activeCompanyId: id, activeProjectId: null });
      },

      setActiveProject: (id: string | null) => {
        set({ activeProjectId: id });
      },

      // --- Branching actions ---

      forkTrack: (companyId: string, parentTrackId: string | null, forkMessageId: string, names: string[]) => {
        const ids: string[] = [];
        const now = Date.now();
        const newProjects: Project[] = names.map((name) => {
          const id = generateId();
          ids.push(id);
          return {
            id,
            companyId,
            name,
            createdAt: now,
            parentTrackId: parentTrackId ?? undefined,
            forkMessageId,
            status: "active" as const,
            isSubtrack: true,
          };
        });
        set((s) => ({
          projects: [...s.projects, ...newProjects],
          // Stay on main — don't auto-jump to first path.
          // FrozenMainBanner will appear so user can choose which path to enter.
        }));
        return ids;
      },

      commitSubtrack: (subtrackId: string) => {
        set((s) => {
          const subtrack = s.projects.find((p) => p.id === subtrackId);
          if (!subtrack || !subtrack.isSubtrack) return s;
          const parentId = subtrack.parentTrackId ?? null;
          // Archive all sibling subtracks (including the committed one)
          const projects = s.projects.map((p) => {
            if (p.isSubtrack && (p.parentTrackId ?? null) === parentId) {
              return { ...p, status: "archived" as const };
            }
            return p;
          });
          return { projects, activeProjectId: parentId };
        });
      },

      closeAllSubtracks: (parentTrackId: string | null) => {
        set((s) => {
          const projects = s.projects.map((p) => {
            if (p.isSubtrack && (p.parentTrackId ?? null) === parentTrackId && p.status === "active") {
              return { ...p, status: "archived" as const };
            }
            return p;
          });
          return { projects, activeProjectId: parentTrackId };
        });
      },

      getActiveSubtracks: (parentTrackId: string | null): Project[] => {
        return get().projects.filter(
          (p: Project) => p.isSubtrack && (p.parentTrackId ?? null) === parentTrackId && p.status === "active"
        );
      },

      upsertCompaniesFromSessions: (sessions, activeSessionId) => {
        if (!sessions || sessions.length === 0) return;
        set((s) => {
          const companies = [...s.companies];
          const norm = (v: string) => v.toLowerCase();

          for (const session of sessions) {
            const sessionId = session.id;
            const name = session.project_name ?? session.name ?? session.id;
            const createdAtRaw = session.created_at ? Date.parse(session.created_at) : NaN;
            const createdAt = Number.isFinite(createdAtRaw) ? createdAtRaw : Date.now();

            let idx = companies.findIndex((c) => c.sessionId === sessionId);
            if (idx === -1) {
              idx = companies.findIndex(
                (c) => !c.sessionId && norm(c.name) === norm(name)
              );
            }

            if (idx === -1) {
              companies.push({
                id: generateId(),
                name,
                sessionId,
                createdAt,
              });
            } else {
              const existing = companies[idx];
              companies[idx] = {
                ...existing,
                // Keep locally renamed name — only use server name if no local name exists
                name: existing.name || name,
                sessionId: existing.sessionId ?? sessionId,
              };
            }
          }

          let activeCompanyId = s.activeCompanyId;
          if (activeSessionId) {
            const active = companies.find((c) => c.sessionId === activeSessionId);
            if (active) activeCompanyId = active.id;
          }
          if (!activeCompanyId && companies.length > 0) {
            activeCompanyId = companies[0].id;
          }

          return { companies, activeCompanyId };
        });
      },
    }),
    {
      name: "workspace-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        companies: s.companies,
        projects: s.projects,
        activeCompanyId: s.activeCompanyId,
        activeProjectId: s.activeProjectId,
      }),
    }
  )
);
