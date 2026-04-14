import { create } from "zustand";
import { authFetch } from "@/lib/auth-fetch";

export interface Datasheet {
  id: string;
  title: string;
  columns: string[];
  rows: Record<string, string>[];
  sessionId?: string;
  chatMessageId?: string;
  createdAt: number;
  updatedAt: number;
}

interface DatasheetsState {
  datasheets: Datasheet[];
  currentSessionId: string | null;
  loading: boolean;

  fetchDatasheets: (sessionId: string | null) => Promise<void>;
  addDatasheet: (ds: Datasheet) => void;
  updateDatasheet: (id: string, updates: { title?: string; columns?: string[]; rows?: Record<string, string>[] }) => void;
  removeDatasheet: (id: string) => void;
}

export const useDatasheetsStore = create<DatasheetsState>((set, get) => ({
  datasheets: [],
  currentSessionId: null,
  loading: false,

  fetchDatasheets: async (sessionId) => {
    if (!sessionId) return;
    set({ loading: true, currentSessionId: sessionId });
    try {
      const res = await authFetch(`/api/datasheets?sessionId=${encodeURIComponent(sessionId)}`);
      if (get().currentSessionId !== sessionId) return;
      if (!res.ok) { set({ loading: false }); return; }
      const data = await res.json();
      set({ datasheets: data.datasheets ?? [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addDatasheet: (ds) => set((s) => ({ datasheets: [ds, ...s.datasheets] })),

  updateDatasheet: (id, updates) => {
    set((s) => ({
      datasheets: s.datasheets.map((ds) => ds.id === id ? { ...ds, ...updates, updatedAt: Date.now() } : ds),
    }));
    authFetch("/api/datasheets", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, ...updates }),
    }).catch(() => {});
  },

  removeDatasheet: (id) => {
    set((s) => ({ datasheets: s.datasheets.filter((ds) => ds.id !== id) }));
    authFetch(`/api/datasheets?id=${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
  },
}));
