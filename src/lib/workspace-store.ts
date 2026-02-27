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
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
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
        set((s) => ({
          companies: s.companies.map((c) =>
            c.id === id ? { ...c, name } : c
          ),
        }));
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
                name,
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
