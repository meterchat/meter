import { create } from "zustand";

export interface Decision {
  id: string;
  title: string;
  status: "undecided" | "decided";
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

  addDecision: (d: Omit<Decision, "id" | "createdAt" | "updatedAt">) => string;
  updateDecision: (id: string, updates: Partial<Decision>) => void;
  deleteDecision: (id: string) => void;
  resolveDecision: (id: string, choice: string, reasoning?: string) => void;
  reopenDecision: (id: string) => void;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export const useDecisionsStore = create<DecisionsState>((set) => ({
  decisions: [],
  panelOpen: false,
  filter: "all",

  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  setPanelOpen: (v) => set({ panelOpen: v }),
  setFilter: (f) => set({ filter: f }),

  addDecision: (d) => {
    const id = generateId();
    const now = Date.now();
    set((s) => ({
      decisions: [
        { ...d, id, createdAt: now, updatedAt: now },
        ...s.decisions,
      ],
    }));
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
}));
