import { create } from "zustand";

export interface Artifact {
  id: string;
  filePath: string;
  content: string;
  status: "draft" | "synced";
  githubRepo?: string;
  githubSha?: string;
  lastGeneratedAt?: number;
  lastPushedAt?: number;
  lastCommittedContent?: string;
  lastCommittedAt?: number;
  projectId?: string;
}

interface ArtifactsState {
  artifacts: Artifact[];
  loading: boolean;
  pushing: boolean;
  targetRepo: string | null;

  fetchArtifacts: (projectId: string | null) => Promise<void>;
  upsertArtifact: (artifact: Partial<Artifact> & { id: string; filePath: string }) => void;
  setTargetRepo: (repo: string | null) => void;
  setPushing: (v: boolean) => void;
  clearArtifacts: () => void;
  commitArtifact: (id: string) => void;
  commitAllArtifacts: () => void;
}

export const useArtifactsStore = create<ArtifactsState>()((set) => ({
  artifacts: [],
  loading: false,
  pushing: false,
  targetRepo: null,

  fetchArtifacts: async (projectId) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (projectId) params.set("projectId", projectId);
      const res = await fetch(`/api/artifacts?${params}`);
      if (!res.ok) {
        set({ loading: false });
        return;
      }
      const data = await res.json();
      set({ artifacts: data.artifacts ?? [], loading: false });
    } catch {
      set({ loading: false });
    }
  },

  upsertArtifact: (artifact) =>
    set((s) => {
      const idx = s.artifacts.findIndex(
        (a) => a.id === artifact.id || a.filePath === artifact.filePath,
      );
      if (idx >= 0) {
        const updated = [...s.artifacts];
        updated[idx] = { ...updated[idx], ...artifact } as Artifact;
        return { artifacts: updated };
      }
      return {
        artifacts: [
          ...s.artifacts,
          {
            content: "",
            status: "draft",
            ...artifact,
          } as Artifact,
        ],
      };
    }),

  setTargetRepo: (repo) => set({ targetRepo: repo }),
  setPushing: (v) => set({ pushing: v }),
  clearArtifacts: () => set({ artifacts: [] }),

  commitArtifact: (id) =>
    set((s) => ({
      artifacts: s.artifacts.map((a) =>
        a.id === id
          ? { ...a, lastCommittedContent: a.content, lastCommittedAt: Date.now() }
          : a
      ),
    })),

  commitAllArtifacts: () =>
    set((s) => ({
      artifacts: s.artifacts.map((a) =>
        a.content
          ? { ...a, lastCommittedContent: a.content, lastCommittedAt: Date.now() }
          : a
      ),
    })),
}));
