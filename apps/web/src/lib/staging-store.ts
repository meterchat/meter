import { create } from "zustand";
import { useDecisionsStore } from "@/lib/decisions-store";
import { useArtifactsStore } from "@/lib/artifacts-store";

export interface StagedDecision {
  id: string;
  title: string;
  choice?: string;
  alternatives?: string[];
  reasoning?: string;
  projectId?: string;
  chatMessageId?: string;
  stagedAt: number;
}

interface StagingState {
  stagedDecisions: StagedDecision[];

  stageDecision: (d: Omit<StagedDecision, "id" | "stagedAt"> & { id?: string }) => string;
  unstageDecision: (id: string) => void;
  clearStaged: () => void;

  commit: (projectId: string) => void;

  getStagedCount: () => number;
  getModifiedArtifacts: () => { filePath: string; status: "new" | "modified" | "unchanged" }[];
  hasChanges: () => boolean;
}

function generateId() {
  return Math.random().toString(36).slice(2, 10);
}

export const useStagingStore = create<StagingState>()((set, get) => ({
  stagedDecisions: [],

  stageDecision: (d) => {
    const id = d.id || generateId();
    const stagedAt = Date.now();
    set((s) => {
      if (s.stagedDecisions.some((existing) => existing.id === id)) return s;
      return {
        stagedDecisions: [...s.stagedDecisions, { ...d, id, stagedAt }],
      };
    });
    return id;
  },

  unstageDecision: (id) =>
    set((s) => ({
      stagedDecisions: s.stagedDecisions.filter((d) => d.id !== id),
    })),

  clearStaged: () => set({ stagedDecisions: [] }),

  commit: (projectId: string) => {
    const { stagedDecisions } = get();
    const decisionsStore = useDecisionsStore.getState();
    const artifactsStore = useArtifactsStore.getState();

    // Move staged decisions to the decisions store
    for (const staged of stagedDecisions) {
      decisionsStore.addDecision({
        id: staged.id,
        title: staged.title,
        status: "decided",
        choice: staged.choice,
        alternatives: staged.alternatives,
        reasoning: staged.reasoning,
        projectId: staged.projectId ?? projectId,
        chatMessageId: staged.chatMessageId,
      });
    }

    // Commit artifact snapshots (update lastCommittedContent)
    const artifacts = artifactsStore.artifacts;
    for (const artifact of artifacts) {
      if (artifact.content && artifact.content !== artifact.lastCommittedContent) {
        artifactsStore.commitArtifact(artifact.id);
      }
    }

    // Clear staging area
    set({ stagedDecisions: [] });
  },

  getStagedCount: () => {
    return get().stagedDecisions.length;
  },

  getModifiedArtifacts: () => {
    const artifacts = useArtifactsStore.getState().artifacts;
    return artifacts.map((a) => {
      if (!a.lastCommittedContent) {
        return { filePath: a.filePath, status: a.content ? "new" as const : "unchanged" as const };
      }
      if (a.content !== a.lastCommittedContent) {
        return { filePath: a.filePath, status: "modified" as const };
      }
      return { filePath: a.filePath, status: "unchanged" as const };
    });
  },

  hasChanges: () => {
    const { stagedDecisions } = get();
    if (stagedDecisions.length > 0) return true;
    const artifacts = useArtifactsStore.getState().artifacts;
    return artifacts.some(
      (a) => a.content && a.content !== a.lastCommittedContent
    );
  },
}));
