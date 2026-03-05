import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { apiUrl } from "@/lib/api-url";

export interface Decision {
  id: string;
  title: string;
  status: "undecided" | "decided";
  archived?: boolean;
  choice?: string;
  alternatives?: string[];
  reasoning?: string;
  projectId?: string;
  chatMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

interface DecisionsState {
  decisions: Decision[];
  panelOpen: boolean;
  filter: "all" | "undecided" | "decided";

  togglePanel: () => void;
  setPanelOpen: (v: boolean) => void;
  setFilter: (f: "all" | "undecided" | "decided") => void;

  addDecision: (d: Omit<Decision, "id" | "createdAt" | "updatedAt"> & { id?: string }) => string;
  updateDecision: (id: string, updates: Partial<Decision>) => void;
  deleteDecision: (id: string) => void;
  resolveDecision: (id: string, choice: string, reasoning?: string) => void;
  reopenDecision: (id: string) => void;
  archiveDecision: (id: string) => void;
  fetchDecisions: () => Promise<void>;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export const useDecisionsStore = create<DecisionsState>()(
  persist(
    (set) => ({
      decisions: [],
      panelOpen: false,
      filter: "all",

      togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
      setPanelOpen: (v) => set({ panelOpen: v }),
      setFilter: (f) => set({ filter: f }),

      addDecision: (d) => {
        const id = d.id || generateId();
        const now = Date.now();
        set((s) => {
          // Skip if a decision with this ID already exists (dedup)
          if (s.decisions.some((existing) => existing.id === id)) return s;
          return {
            decisions: [
              { ...d, id, createdAt: now, updatedAt: now },
              ...s.decisions,
            ],
          };
        });
        return id;
      },

      updateDecision: (id, updates) =>
        set((s) => ({
          decisions: s.decisions.map((d) =>
            d.id === id ? { ...d, ...updates, updatedAt: Date.now() } : d
          ),
        })),

      deleteDecision: (id) =>
        set((s) => ({
          decisions: s.decisions.filter((d) => d.id !== id),
        })),

      resolveDecision: (id, choice, reasoning) =>
        set((s) => ({
          decisions: s.decisions.map((d) =>
            d.id === id
              ? { ...d, status: "decided" as const, choice, reasoning, updatedAt: Date.now() }
              : d
          ),
        })),

      reopenDecision: (id) =>
        set((s) => ({
          decisions: s.decisions.map((d) =>
            d.id === id
              ? { ...d, status: "undecided" as const, updatedAt: Date.now() }
              : d
          ),
        })),

      archiveDecision: (id) =>
        set((s) => ({
          decisions: s.decisions.map((d) =>
            d.id === id
              ? { ...d, archived: true, updatedAt: Date.now() }
              : d
          ),
        })),

      fetchDecisions: async () => {
        try {
          const res = await fetch(apiUrl("/api/decisions"));
          if (!res.ok) return;
          const data = await res.json();
          if (!data.decisions?.length) return;

          const serverDecisions = data.decisions as Decision[];

          set((s) => {
            // Merge server decisions into local, deduplicating by ID and by title+projectId
            const localIds = new Set(s.decisions.map((d) => d.id));
            const localKeys = new Set(s.decisions.map((d) => `${d.title}::${d.projectId ?? ""}`));
            const newFromServer = serverDecisions.filter(
              (d) => !localIds.has(d.id) && !localKeys.has(`${d.title}::${d.projectId ?? ""}`)
            );
            if (newFromServer.length === 0) return s;
            return { decisions: [...newFromServer, ...s.decisions] };
          });
        } catch {
          // Silent fail — localStorage still works as fallback
        }
      },
    }),
    {
      name: "decisions-store-v1",
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        decisions: s.decisions,
      }),
    }
  )
);
