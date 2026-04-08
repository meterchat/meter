import { create } from "zustand";
import { authFetch } from "@/lib/auth-fetch";

export interface WorkspaceInput {
  id: string;
  fileName: string;
  filePath: string;
  publicUrl: string;
  mimeType: string;
  fileSize: number;
  contentText?: string | null;
  enabled: boolean;
  sessionId?: string;
  createdAt: number;
}

interface InputsState {
  inputs: WorkspaceInput[];
  currentSessionId: string | null;
  loading: boolean;
  uploading: boolean;

  fetchInputs: (sessionId: string | null) => Promise<void>;
  addInput: (input: WorkspaceInput) => void;
  removeInput: (id: string) => Promise<void>;
  toggleInput: (id: string) => void;
  clearInputs: () => void;
  setUploading: (v: boolean) => void;
}

export const useInputsStore = create<InputsState>((set, get) => ({
  inputs: [],
  currentSessionId: null,
  loading: false,
  uploading: false,

  fetchInputs: async (sessionId) => {
    if (!sessionId) return;
    set({ loading: true, currentSessionId: sessionId });

    try {
      const res = await authFetch(`/api/inputs?sessionId=${encodeURIComponent(sessionId)}`);
      if (get().currentSessionId !== sessionId) return;
      if (!res.ok) {
        set({ loading: false });
        return;
      }
      const data = await res.json();
      set({ inputs: data.inputs ?? [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  addInput: (input) =>
    set((s) => ({ inputs: [input, ...s.inputs] })),

  removeInput: async (id) => {
    set((s) => ({ inputs: s.inputs.filter((i) => i.id !== id) }));
    try {
      await authFetch(`/api/inputs?id=${encodeURIComponent(id)}`, { method: "DELETE" });
    } catch { /* silent */ }
  },

  toggleInput: (id) => {
    const input = get().inputs.find((i) => i.id === id);
    if (!input) return;
    const newEnabled = !input.enabled;
    // Optimistic update
    set((s) => ({
      inputs: s.inputs.map((i) => i.id === id ? { ...i, enabled: newEnabled } : i),
    }));
    // Persist
    authFetch("/api/inputs", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id, enabled: newEnabled }),
    }).catch(() => {});
  },

  clearInputs: () => set({ inputs: [], currentSessionId: null }),

  setUploading: (v) => set({ uploading: v }),
}));
