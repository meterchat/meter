import { create } from "zustand";

export interface SyncFinding {
  id: string;
  type: "contradiction" | "gap" | "stale" | "conflict";
  severity: "high" | "medium" | "low";
  title: string;
  description: string;
  /** References to specific decisions, docs, or messages */
  references: { kind: "decision" | "document" | "message"; id: string; label: string }[];
  /** Whether user dismissed this finding */
  dismissed?: boolean;
  /** Whether this was auto-fixed */
  fixed?: boolean;
  /** Brief description of what was changed during reconciliation */
  fixSummary?: string;
}

export interface SyncReport {
  id: string;
  timestamp: number;
  findings: SyncFinding[];
  totalPasses: number;
  status: "running" | "complete" | "error";
  /** Current pass number (1-indexed) */
  currentPass: number;
  /** Cost of the sync run */
  cost: number;
  /** Error message if status is "error" */
  error?: string;
}

interface SyncState {
  /** The most recent sync report */
  lastReport: SyncReport | null;
  /** Whether a sync is currently running */
  isSyncing: boolean;
  /** Whether reconciliation is currently running */
  isReconciling: boolean;
  /** How many findings have been reconciled so far */
  reconciledCount: number;
  /** Total findings being reconciled */
  reconcileTotal: number;
  /** Cost of the reconciliation run */
  reconcileCost: number;
  /** Error during reconciliation */
  reconcileError: string | null;
  /** AbortController for cancelling in-flight sync/reconcile */
  abortController: AbortController | null;

  /** Set when sync starts */
  startSync: () => string;
  /** Update progress during sync */
  updateProgress: (reportId: string, update: Partial<SyncReport>) => void;
  /** Add a finding during sync */
  addFinding: (reportId: string, finding: SyncFinding) => void;
  /** Complete the sync */
  completeSync: (reportId: string, error?: string) => void;
  /** Dismiss a specific finding */
  dismissFinding: (findingId: string) => void;
  /** Mark a finding as fixed */
  markFixed: (findingId: string) => void;
  /** Set a fix summary on a finding after reconciliation */
  setFixSummary: (findingId: string, summary: string) => void;
  /** Clear the last report */
  clearReport: () => void;
  /** Cancel any running sync or reconcile */
  cancelOperation: () => void;

  /** Start reconciliation */
  startReconcile: (total: number) => void;
  /** Update reconcile progress */
  updateReconcileProgress: (count: number, cost: number) => void;
  /** Complete reconciliation */
  completeReconcile: (error?: string) => void;
}

export const useSyncStore = create<SyncState>((set, get) => ({
  lastReport: null,
  isSyncing: false,
  isReconciling: false,
  reconciledCount: 0,
  reconcileTotal: 0,
  reconcileCost: 0,
  reconcileError: null,
  abortController: null,

  startSync: () => {
    // Abort any previous operation
    get().abortController?.abort();
    const controller = new AbortController();
    const id = Math.random().toString(36).slice(2, 10);
    const report: SyncReport = {
      id,
      timestamp: Date.now(),
      findings: [],
      totalPasses: 5,
      status: "running",
      currentPass: 1,
      cost: 0,
    };
    set({ lastReport: report, isSyncing: true, abortController: controller });
    return id;
  },

  updateProgress: (reportId, update) => {
    const { lastReport } = get();
    if (!lastReport || lastReport.id !== reportId) return;
    set({ lastReport: { ...lastReport, ...update } });
  },

  addFinding: (reportId, finding) => {
    const { lastReport } = get();
    if (!lastReport || lastReport.id !== reportId) return;
    set({ lastReport: { ...lastReport, findings: [...lastReport.findings, finding] } });
  },

  completeSync: (reportId, error) => {
    const { lastReport } = get();
    if (!lastReport || lastReport.id !== reportId) return;
    set({
      lastReport: {
        ...lastReport,
        status: error ? "error" : "complete",
        error,
        currentPass: lastReport.totalPasses,
      },
      isSyncing: false,
    });
  },

  dismissFinding: (findingId) => {
    const { lastReport } = get();
    if (!lastReport) return;
    set({
      lastReport: {
        ...lastReport,
        findings: lastReport.findings.map((f) =>
          f.id === findingId ? { ...f, dismissed: true } : f
        ),
      },
    });
  },

  markFixed: (findingId) => {
    const { lastReport } = get();
    if (!lastReport) return;
    set({
      lastReport: {
        ...lastReport,
        findings: lastReport.findings.map((f) =>
          f.id === findingId ? { ...f, fixed: true } : f
        ),
      },
    });
  },

  setFixSummary: (findingId, summary) => {
    const { lastReport } = get();
    if (!lastReport) return;
    set({
      lastReport: {
        ...lastReport,
        findings: lastReport.findings.map((f) =>
          f.id === findingId ? { ...f, fixSummary: summary } : f
        ),
      },
    });
  },

  clearReport: () => set({ lastReport: null }),

  cancelOperation: () => {
    const { abortController, isSyncing, isReconciling, lastReport } = get();
    abortController?.abort();
    if (isSyncing && lastReport) {
      set({
        isSyncing: false,
        abortController: null,
        lastReport: { ...lastReport, status: "complete" },
      });
    }
    if (isReconciling) {
      set({
        isReconciling: false,
        abortController: null,
      });
    }
  },

  startReconcile: (total) => {
    get().abortController?.abort();
    const controller = new AbortController();
    set({
      isReconciling: true,
      reconciledCount: 0,
      reconcileTotal: total,
      reconcileCost: 0,
      reconcileError: null,
      abortController: controller,
    });
  },

  updateReconcileProgress: (count, cost) => set({
    reconciledCount: count,
    reconcileCost: cost,
  }),

  completeReconcile: (error) => set({
    isReconciling: false,
    reconcileError: error ?? null,
  }),
}));
