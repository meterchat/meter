import { create } from "zustand";
import { authFetch } from "@/lib/auth-fetch";

export interface Artifact {
  id: string;
  filePath: string;
  content: string;
  status: "draft" | "synced";
  category?: string;
  githubRepo?: string;
  githubSha?: string;
  lastGeneratedAt?: number;
  lastPushedAt?: number;
  lastCommittedContent?: string;
  lastCommittedAt?: number;
  sessionId?: string;
}

interface ArtifactsState {
  artifacts: Artifact[];
  currentSessionId: string | null;
  loading: boolean;
  pushing: boolean;
  targetRepo: string | null;

  fetchArtifacts: (sessionId: string | null) => Promise<void>;
  upsertArtifact: (artifact: Partial<Artifact> & { id: string; filePath: string }) => void;
  setTargetRepo: (repo: string | null) => void;
  setPushing: (v: boolean) => void;
  clearArtifacts: () => void;
  commitArtifact: (id: string) => void;
  commitAllArtifacts: () => void;
}

export const useArtifactsStore = create<ArtifactsState>()((set) => ({
  artifacts: [],
  currentSessionId: null,
  loading: false,
  pushing: false,
  targetRepo: null,

  fetchArtifacts: async (sessionId) => {
    set({ loading: true });
    try {
      const params = new URLSearchParams();
      if (sessionId) params.set("sessionId", sessionId);
      const res = await authFetch(`/api/artifacts?${params}`);
      if (!res.ok) {
        set({ loading: false });
        return;
      }
      const data = await res.json();
      const fetched = (data.artifacts ?? []).map((a: Artifact) => ({
        ...a,
        sessionId: a.sessionId ?? sessionId ?? undefined,
        lastCommittedContent: a.lastCommittedContent ?? a.content,
      }));
      // Merge: server data wins for existing artifacts, but preserve
      // any client-only artifacts (upserted during streaming) that
      // the server hasn't returned yet — only if they belong to the
      // same workspace session. This prevents data leaking across workspaces.
      set((s) => {
        const switchedWorkspace =
          s.currentSessionId !== null &&
          s.currentSessionId !== sessionId;
        const serverIds = new Set(fetched.map((a: Artifact) => a.id));
        const serverPaths = new Set(fetched.map((a: Artifact) => a.filePath));
        const clientOnly = switchedWorkspace
          ? [] // discard client-only artifacts from previous workspace
          : s.artifacts.filter(
              (a) => !serverIds.has(a.id) && !serverPaths.has(a.filePath)
            );
        return { artifacts: [...fetched, ...clientOnly], currentSessionId: sessionId, loading: false };
      });
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
  clearArtifacts: () => set({ artifacts: [], currentSessionId: null }),

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
