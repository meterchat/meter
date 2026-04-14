"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useMeterStore, selectWorkspaceCardReady } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore, Decision } from "@/lib/decisions-store";
import { useDatasheetsStore } from "@/lib/datasheets-store";
import { useArtifactsStore, Artifact } from "@/lib/artifacts-store";
import { useInputsStore, type WorkspaceInput } from "@/lib/inputs-store";
import { authFetch } from "@/lib/auth-fetch";
import { getModel } from "@/lib/models";
import { SYSTEM_PROMPT } from "@/lib/tools";
import { useIsMobile } from "@/hooks/use-mobile";
import { emitLogEvent } from "@/lib/log-event";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
  trackWorkspaceDeleted,
  trackWorkspaceRenamed,
  trackDecisionArchived,
  trackDecisionReopened,
  trackDecisionRevisited,
  trackArtifactGenerated,
  trackInspectorToggled,
  trackInspectorTabChanged,
} from "@/lib/analytics";

const INSPECTOR_TABS = ["context", "memory", "connect"] as const;

function DeleteDangerZone({
  workspaceName,
  deleteConfirmText,
  onConfirmTextChange,
  onDelete,
  deleting,
  settlingBeforeDelete,
  deleteSettleError,
  isLastWorkspace,
}: {
  workspaceName: string;
  deleteConfirmText: string;
  onConfirmTextChange: (v: string) => void;
  onDelete: () => void;
  deleting: boolean;
  settlingBeforeDelete: boolean;
  deleteSettleError: string | null;
  isLastWorkspace?: boolean;
}) {
  const pendingBalance = useMeterStore.getState().getPendingBalance();
  const hasPending = pendingBalance > 0.01;
  const busy = deleting || settlingBeforeDelete;

  return (
    <div className="flex flex-col gap-3">
      <div className="font-sans text-xs text-red-400/70 uppercase tracking-wider">
        Danger Zone
      </div>
      {isLastWorkspace ? (
        <p className="font-sans text-xs text-muted-foreground/60 leading-relaxed">
          Create another workspace before deleting this one.
        </p>
      ) : (
      <>
      <p className="font-sans text-xs text-muted-foreground/60 leading-relaxed">
        Type <span className="text-foreground/80">{workspaceName}</span> to confirm deletion. This removes all messages and data for this workspace.
      </p>
      {hasPending && (
        <p className="font-sans text-xs text-amber-400/90 leading-relaxed">
          You have ${pendingBalance.toFixed(2)} pending. Your card on file will be charged before this workspace is deleted.
        </p>
      )}
      <input
        type="text"
        value={deleteConfirmText}
        onChange={(e) => onConfirmTextChange(e.target.value)}
        placeholder={workspaceName}
        className="h-9 rounded-lg border border-red-500/20 bg-background px-3 font-sans text-xs text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-red-500/40 transition-colors"
      />
      {deleteSettleError && (
        <p className="font-sans text-xs text-red-400 leading-relaxed">
          {deleteSettleError}
        </p>
      )}
      <button
        onClick={onDelete}
        disabled={busy || deleteConfirmText !== workspaceName}
        className="h-9 rounded-lg bg-red-500/10 border border-red-500/20 font-sans text-xs text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {settlingBeforeDelete ? "Settling..." : deleting ? "Deleting..." : hasPending ? "Settle & Delete" : "Delete Workspace"}
      </button>
      <p className="font-sans text-xs text-muted-foreground/70 leading-relaxed">
        Deleted workspaces are retained for 7 days. To recover, email support@meter.chat within 7 days of deletion.
      </p>
      </>
      )}
    </div>
  );
}

export function Inspector() {
  const {
    inspectorOpen,
    setInspectorOpen,
    inspectorTab,
    setInspectorTab,
    sessions,
    activeSessionId,
    userId,
    removeSession,
  } = useMeterStore();

  const activeWorkspaceId = useWorkspaceStore((s) => s.activeWorkspaceId);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const deleteWorkspace = useWorkspaceStore((s) => s.deleteWorkspace);
  const renameWorkspace = useWorkspaceStore((s) => s.renameWorkspace);
  const setActiveWorkspace = useWorkspaceStore((s) => s.setActiveWorkspace);

  const activeWorkspace = workspaces.find((c) => c.id === activeWorkspaceId) ?? null;
  const activeSession = sessions.find((p) => p.id === activeSessionId) ?? null;

  const [manageOpen, setManageOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [editingName, setEditingName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [feedbackText, setFeedbackText] = useState("");
  const [feedbackSent, setFeedbackSent] = useState(false);
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);
  const [deleteSettleError, setDeleteSettleError] = useState<string | null>(null);
  const [settlingBeforeDelete, setSettlingBeforeDelete] = useState(false);
  const [archiving, setArchiving] = useState(false);
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!INSPECTOR_TABS.includes(inspectorTab as typeof INSPECTOR_TABS[number])) {
      setInspectorTab("context");
    }
  }, [inspectorTab, setInspectorTab]);

  const isLastWorkspace = workspaces.length <= 1;

  const handleArchiveWorkspace = async () => {
    if (!activeWorkspace) return;
    const sessionId = activeWorkspace.sessionId;
    const isArchived = activeWorkspace.archived;
    setArchiving(true);
    try {
      if (sessionId) {
        await authFetch(
          `/api/sessions?sessionId=${encodeURIComponent(sessionId)}&action=${isArchived ? "unarchive" : "archive"}`,
          { method: "PATCH" },
        );
      }
      useWorkspaceStore.getState().archiveWorkspace(activeWorkspace.id, !isArchived);
    } catch { /* silent */ }
    setArchiving(false);
    if (!isArchived) setManageOpen(false);
  };

  const handleDeleteWorkspace = async () => {
    if (!activeWorkspace) return;
    if (isLastWorkspace) return;

    // Settle any pending balance before deletion — but skip if below
    // Stripe's $0.50 minimum (will be collected on next settlement)
    const store = useMeterStore.getState();
    const pendingBalance = store.getPendingBalance();
    if (pendingBalance >= 0.50) {
      setSettlingBeforeDelete(true);
      setDeleteSettleError(null);
      const result = await store.settleAll();
      setSettlingBeforeDelete(false);
      if (!result.success) {
        setDeleteSettleError(result.error ?? "Settlement failed. Please update your payment method and try again.");
        return;
      }
    }

    trackWorkspaceDeleted({ workspaceId: activeWorkspace.id, workspaceName: activeWorkspace.name });
    setDeleting(true);

    // Soft-delete server-side session (sets deleted_at, retained 7 days)
    const sessionId = activeWorkspace.sessionId;
    if (sessionId) {
      try {
        await fetch(
          `/api/sessions?sessionId=${encodeURIComponent(sessionId)}`,
          { method: "DELETE" }
        );
      } catch {
        // Continue with local deletion even if server fails
      }
    }

    // Remove from local stores
    if (sessionId) removeSession(sessionId);
    const workspaceId = activeWorkspace.id;
    deleteWorkspace(workspaceId);

    // Switch to next available workspace
    const remaining = workspaces.filter((c) => c.id !== workspaceId);
    if (remaining.length > 0) {
      setActiveWorkspace(remaining[0].id);
      const nextSession = remaining[0].sessionId;
      if (nextSession) {
        const { setActiveSession } = useMeterStore.getState();
        setActiveSession(nextSession);
      }
    }

    setManageOpen(false);
    setDeleteConfirmText("");
    setDeleting(false);
    setInspectorOpen(false);
  };

  const handleFeedbackSubmit = async () => {
    if (!feedbackText.trim() || feedbackSubmitting) return;
    setFeedbackSubmitting(true);
    emitLogEvent("feedback_logged", userId, { feedbackText: feedbackText.trim() });
    setFeedbackOpen(false);
    setFeedbackText("");
    setFeedbackSubmitting(false);
    setFeedbackSent(true);
    setTimeout(() => setFeedbackSent(false), 3000);
  };

  const openManageDialog = () => {
    if (activeWorkspace) {
      setEditingName(activeWorkspace.name);
      setNameEdited(false);
      setDeleteConfirmText("");
      setDeleteSettleError(null);
    }
    setManageOpen(true);
  };

  const handleSaveName = () => {
    if (!activeWorkspace || !editingName.trim()) return;
    trackWorkspaceRenamed({ workspaceId: activeWorkspace.id, oldName: activeWorkspace.name, newName: editingName.trim() });
    renameWorkspace(activeWorkspace.id, editingName.trim());
    setNameEdited(false);
  };

  const isMobile = useIsMobile();

  const handleClose = () => {
    trackInspectorToggled({ open: false });
    setInspectorOpen(false);
  };

  if (!inspectorOpen) return null;

  const inspectorContent = (
    <>
      <div className="flex h-12 items-center justify-between border-b border-border px-4">
        <span className="font-sans text-xs text-muted-foreground uppercase tracking-wider">
          Meter
        </span>
        <button
          onClick={handleClose}
          className="mobile-sm-ok text-muted-foreground hover:text-foreground transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>

      <div className="flex border-b border-border">
        {INSPECTOR_TABS.map((tab) => (
          <button
            key={tab}
            onClick={() => { trackInspectorTabChanged({ tab }); setInspectorTab(tab); }}
          className={`flex-1 py-2.5 font-sans text-xs uppercase tracking-wider transition-colors ${
              inspectorTab === tab
                ? "text-foreground border-b border-foreground"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {tab}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-y-auto p-4">
        {inspectorTab === "context" && <InputsTab activeSessionId={activeSession?.id ?? null} />}
        {inspectorTab === "memory" && <DecisionsTab activeSessionId={activeSession?.id ?? null} />}
        {inspectorTab === "connect" && <ConnectTab />}
      </div>

      {activeWorkspace && (
        <div className="relative border-t border-border px-4 py-3 flex items-center justify-between" style={{ paddingBottom: isMobile ? "calc(0.75rem + env(safe-area-inset-bottom, 0px))" : undefined }}>
          <button
            onClick={openManageDialog}
            className="rounded-md py-1.5 px-2 font-sans text-xs text-muted-foreground/80 transition-colors hover:text-foreground hover:bg-foreground/5"
          >
            Manage workspace
          </button>

          {/* Docs button */}
          <button
            onClick={async () => {
              const sessionId = activeSession?.id;
              if (!sessionId) return;
              try {
                const res = await authFetch(`/api/portal?sessionId=${encodeURIComponent(sessionId)}`);
                if (res.ok) {
                  const d = await res.json();
                  if (d.slug && d.handle) window.open(`/docs/${d.handle}/${d.slug}`, "_blank");
                }
              } catch { /* silent */ }
            }}
            className="inline-flex items-center gap-1.5 rounded-md py-1.5 px-2 font-sans text-xs text-muted-foreground/80 transition-colors hover:text-foreground hover:bg-foreground/5"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M4 19.5A2.5 2.5 0 016.5 17H20" /><path d="M4 19.5A2.5 2.5 0 006.5 22H20V2H6.5A2.5 2.5 0 004 4.5v15z" />
            </svg>
            Docs
          </button>
        </div>
      )}
    </>
  );

  const manageDialog = manageOpen && activeWorkspace ? (
    <>
      <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={() => setManageOpen(false)} />
      <div className={`fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl border border-border bg-card shadow-2xl ${isMobile ? "w-[calc(100%-2rem)]" : "w-[380px]"}`}>
        <div className="flex items-center justify-between border-b border-border px-5 py-4">
          <span className="font-sans text-xs uppercase tracking-wider text-foreground">
            Manage Workspace
          </span>
          <button
            onClick={() => setManageOpen(false)}
            className="mobile-sm-ok text-muted-foreground hover:text-foreground transition-colors"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="p-5 flex flex-col gap-5">
          {/* Workspace Name */}
          <div className="flex flex-col gap-2">
            <label className="font-sans text-xs text-muted-foreground/60 uppercase tracking-wider">
              Workspace Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={editingName}
                onChange={(e) => { setEditingName(e.target.value); setNameEdited(true); }}
                className="flex-1 h-9 rounded-lg border border-border bg-background px-3 font-sans text-xs text-foreground placeholder:text-muted-foreground/80 focus:outline-none focus:border-foreground/30 transition-colors"
              />
              {nameEdited && editingName.trim() && editingName.trim() !== activeWorkspace.name && (
                <button
                  onClick={handleSaveName}
                  className="h-9 rounded-lg bg-foreground px-3 font-sans text-xs text-background transition-colors hover:bg-foreground/90"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          {/* Archive */}
          <div className="flex items-center justify-between">
            <div>
              <div className="font-sans text-xs font-medium text-foreground/80">Archive Workspace</div>
              <div className="font-sans text-[11px] text-muted-foreground/60 mt-0.5">
                {activeWorkspace.archived ? "This workspace is archived. Unarchive to resume." : "Remove from active list. Messages and docs are kept."}
              </div>
            </div>
            <button
              onClick={handleArchiveWorkspace}
              disabled={archiving}
              className="shrink-0 rounded-md border border-border px-3 py-1.5 font-sans text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
            >
              {archiving ? "..." : activeWorkspace.archived ? "Unarchive" : "Archive"}
            </button>
          </div>

          <div className="h-px bg-border" />

          {/* Danger Zone */}
          <DeleteDangerZone
            workspaceName={activeWorkspace.name}
            deleteConfirmText={deleteConfirmText}
            onConfirmTextChange={setDeleteConfirmText}
            onDelete={handleDeleteWorkspace}
            deleting={deleting}
            settlingBeforeDelete={settlingBeforeDelete}
            deleteSettleError={deleteSettleError}
            isLastWorkspace={isLastWorkspace}
          />
        </div>
      </div>
    </>
  ) : null;

  if (isMobile) {
    return (
      <>
        <Drawer open={inspectorOpen} onOpenChange={(open) => { if (!open) handleClose(); }}>
          <DrawerContent className="h-[85vh] bg-card">
            <div className="flex h-full flex-col">
              {inspectorContent}
            </div>
          </DrawerContent>
        </Drawer>
        {manageDialog}
      </>
    );
  }

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={handleClose} />
      <div className="fixed right-0 top-0 h-screen w-[420px] border-l border-border bg-card flex flex-col z-50">
        {inspectorContent}
      </div>
      {manageDialog}
    </>
  );
}

/* ─── DECISIONS TAB ─── */

const CATEGORY_ORDER = ["branding", "architecture", "product", "engineering", "billing", "strategy", "other"];

function VersionHistory({ title, projectId }: { title: string; projectId?: string }) {
  const fetchDecisionHistory = useDecisionsStore((s) => s.fetchDecisionHistory);
  const [history, setHistory] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetchDecisionHistory(title, projectId).then((h) => {
      if (!cancelled) { setHistory(h); setLoading(false); }
    });
    return () => { cancelled = true; };
  }, [title, projectId, fetchDecisionHistory]);

  if (loading) return <p className="font-sans text-xs text-muted-foreground/60">Loading history...</p>;
  if (history.length === 0) return null;

  return (
    <div className="mt-1.5">
      <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground/80">History</span>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {history.map((h) => (
          <div key={h.id} className="font-sans text-xs text-foreground/90">
            <span className="text-muted-foreground/80">v{h.version ?? 1}</span>
            <span className="mx-1 text-muted-foreground/70">&middot;</span>
            <span className="text-muted-foreground/60">{new Date(h.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <span className="mx-1 text-muted-foreground/70">&mdash;</span>
            <span>{h.choice}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function DecisionRow({ decision }: { decision: Decision }) {
  const { archiveDecision, reopenDecision } = useDecisionsStore();
  const setPendingInput = useMeterStore((s) => s.setPendingInput);
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);
  const isDecided = decision.status === "decided";
  const isContested = isDecided && (decision.revisitCount ?? 0) >= 2;
  const version = decision.version ?? 1;

  const dotColor = !isDecided
    ? "bg-amber-500"
    : isContested
      ? "bg-amber-400"
      : "bg-emerald-500/60";

  const statusLabel = !isDecided
    ? "open"
    : isContested
      ? `revisited ${decision.revisitCount}x`
      : null;

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const parts = [`# ${decision.title}`];
    if (decision.choice) parts.push(`**Choice:** ${decision.choice}`);
    if (decision.reasoning) parts.push(`**Reasoning:** ${decision.reasoning}`);
    if (decision.status) parts.push(`**Status:** ${decision.status}`);
    await navigator.clipboard.writeText(parts.join("\n\n"));
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const handleRevisit = () => {
    trackDecisionRevisited({ decisionId: decision.id, status: decision.status });
    if (isDecided) {
      trackDecisionReopened({ decisionId: decision.id });
      reopenDecision(decision.id);
    }
    const msg = isDecided
      ? `I want to revisit the decision "${decision.title}" — we chose "${decision.choice}". Can we reconsider this?`
      : `Let's discuss the open decision "${decision.title}" and make a call.`;
    setPendingInput(msg);
  };

  return (
    <div className="rounded-md transition-colors">
      <div
        className="group relative flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-foreground/[0.02]"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted-foreground/70 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
        <span className="flex-1 truncate font-sans text-xs text-foreground/80">
          {decision.title}
          {version > 1 && (
            <span className="ml-1 text-muted-foreground/70 text-xs">(v{version})</span>
          )}
        </span>
        <div className="absolute right-1 flex items-center gap-1 rounded bg-background/90 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
          <button
            onClick={handleCopy}
            className="rounded px-1.5 py-0.5 font-sans text-xs text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            {copied ? "copied" : "copy"}
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); handleRevisit(); }}
            className="rounded px-1.5 py-0.5 font-sans text-xs text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            revisit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); trackDecisionArchived({ decisionId: decision.id }); archiveDecision(decision.id); }}
            className="rounded px-1.5 py-0.5 font-sans text-xs text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            archive
          </button>
        </div>
        {statusLabel ? (
          <span
            className={`shrink-0 rounded-full px-1.5 py-0.5 font-sans text-xs tracking-wider group-hover:opacity-0 transition-opacity ${
              !isDecided
                ? "bg-amber-500/10 text-amber-500"
                : "bg-amber-400/10 text-amber-400"
            }`}
          >
            {statusLabel}
          </span>
        ) : null}
      </div>

      {expanded && (
        <div className="ml-6 mr-1 mb-2 mt-0.5 flex flex-col gap-1.5 border-l border-border/40 pl-3">
          {decision.choice && (
            <div>
              <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground/80">Choice</span>
              <p className="font-sans text-xs text-foreground/90 mt-0.5">{decision.choice}</p>
            </div>
          )}
          {version > 1 && (
            <VersionHistory title={decision.title} projectId={decision.sessionId} />
          )}
          {decision.reasoning && (
            <div>
              <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground/80">Reasoning</span>
              <p className="font-sans text-xs text-foreground/90 mt-0.5">{decision.reasoning}</p>
            </div>
          )}
          {!decision.choice && !decision.reasoning && (
            <p className="font-sans text-xs text-muted-foreground/60 italic">No details recorded</p>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryGroup({ category, decisions }: { category: string; decisions: Decision[] }) {
  return (
    <div className="mb-3">
      <div className="font-sans text-xs uppercase tracking-wider text-muted-foreground/70 mb-1 capitalize">
        {category}
      </div>
      <div className="flex flex-col gap-0.5">
        {decisions.map((d) => (
          <DecisionRow key={d.id} decision={d} />
        ))}
      </div>
    </div>
  );
}

/* ─── PINS SECTION ─── */
function formatPinTime(ts: number) {
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function PinsSection({ activeSessionId }: { activeSessionId: string | null }) {
  const sessions = useMeterStore((s) => s.sessions);
  const togglePinMessage = useMeterStore((s) => s.togglePinMessage);
  const setScrollToMessageId = useMeterStore((s) => s.setScrollToMessageId);
  const session = sessions.find((p) => p.id === activeSessionId);
  const pinned = session?.messages.filter((m) => m.pinned) ?? [];

  if (pinned.length === 0) return null;

  const handleClick = (msgId: string) => {
    setScrollToMessageId(msgId);
  };

  return (
    <div>
      <div className="font-sans text-xs text-muted-foreground/60 uppercase tracking-wider mb-2">
        Pinned
      </div>
      <div className="flex flex-col gap-1">
        {pinned.map((msg) => {
          const preview = msg.content.replace(/[#*`_~>\[\]]/g, "").slice(0, 100);
          const modelLabel = msg.model ?? "";
          const costLabel = msg.cost != null ? `$${msg.cost.toFixed(4)}` : "";
          const timeLabel = formatPinTime(msg.timestamp);
          const meta = [modelLabel, costLabel, timeLabel].filter(Boolean).join(" · ");
          return (
            <div
              key={msg.id}
              onClick={() => handleClick(msg.id)}
              className="group relative rounded-md border border-border/50 px-3 py-2 hover:bg-foreground/[0.03] transition-colors cursor-pointer"
            >
              <p className="font-sans text-xs text-foreground/90 leading-relaxed line-clamp-2">
                {preview}{msg.content.length > 100 ? "..." : ""}
              </p>
              {meta && (
                <span className="mt-1 block font-sans text-xs text-muted-foreground/70">
                  {meta}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); togglePinMessage(msg.id); }}
                className="absolute right-1.5 top-1.5 hidden group-hover:block rounded p-0.5 text-muted-foreground/70 hover:text-amber-500 transition-colors"
                title="Unpin"
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <line x1="18" y1="6" x2="6" y2="18" />
                  <line x1="6" y1="6" x2="18" y2="18" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── MCP Connector definitions ─────────────────────────────────── */

interface McpConnector {
  id: string;
  name: string;
  icon: string; // SVG path data (24×24 viewBox)
  instructions: (apiKey: string) => { label: string; snippet: string }[];
}

const MCP_CONNECTORS: McpConnector[] = [
  {
    id: "claude-code",
    name: "Claude Code",
    icon: "M20.998 10.949H24v3.102h-3v3.028h-1.487V20H18v-2.921h-1.487V20H15v-2.921H9V20H7.488v-2.921H6V20H4.487v-2.921H3V14.05H0V10.95h3V5h17.998v5.949zM6 10.949h1.488V8.102H6v2.847zm10.51 0H18V8.102h-1.49v2.847z",
    instructions: (apiKey) => [
      {
        label: "Run in your terminal",
        snippet: `claude mcp add meter --transport http https://meter.chat/api/mcp -H "Authorization: Bearer ${apiKey}"`,
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: "M22.106 5.68L12.5.135a.998.998 0 00-.998 0L1.893 5.68a.84.84 0 00-.419.726v11.186c0 .3.16.577.42.727l9.607 5.547a.999.999 0 00.998 0l9.608-5.547a.84.84 0 00.42-.727V6.407a.84.84 0 00-.42-.726zm-.603 1.176L12.228 22.92c-.063.108-.228.064-.228-.061V12.34a.59.59 0 00-.295-.51l-9.11-5.26c-.107-.062-.063-.228.062-.228h18.55c.264 0 .428.286.296.514z",
    instructions: (apiKey) => [
      {
        label: "Add to Settings → MCP Servers",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                url: "https://meter.chat/api/mcp",
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2
        ),
      },
    ],
  },
  {
    id: "lovable",
    name: "Lovable",
    icon: "M7.082 0c3.91 0 7.081 3.179 7.081 7.1v2.7h2.357c3.91 0 7.082 3.178 7.082 7.1 0 3.923-3.17 7.1-7.082 7.1H0V7.1C0 3.18 3.17 0 7.082 0z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                url: "https://meter.chat/api/mcp",
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2
        ),
      },
    ],
  },
  {
    id: "replit",
    name: "Replit",
    icon: "M11.878 7.761H3.482A1.469 1.469 0 012 6.304V1.457C2 .644 2.67 0 3.482 0h6.913c.827 0 1.483.658 1.483 1.457v6.304zM20.882 16.215h-8.995V7.75h8.995c.87 0 1.588.717 1.588 1.586v5.294c0 .885-.717 1.586-1.588 1.586zM10.395 24H3.482C2.67 24 2 23.343 2 22.546v-4.853c0-.797.67-1.454 1.482-1.454h8.396v6.307c0 .797-.67 1.454-1.483 1.454z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                url: "https://meter.chat/api/mcp",
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2
        ),
      },
    ],
  },
  {
    id: "antigravity",
    name: "Antigravity",
    icon: "M21.751 22.607c1.34 1.005 3.35.335 1.508-1.508C17.73 15.74 18.904 1 12.037 1 5.17 1 6.342 15.74.815 21.1c-2.01 2.009.167 2.511 1.507 1.506 5.192-3.517 4.857-9.714 9.715-9.714 4.857 0 4.522 6.197 9.714 9.715z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                url: "https://meter.chat/api/mcp",
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2
        ),
      },
    ],
  },
  {
    id: "codex",
    name: "Codex",
    icon: "M8.086.457a6.105 6.105 0 013.046-.415c1.333.153 2.521.72 3.564 1.7a.117.117 0 00.107.029c1.408-.346 2.762-.224 4.061.366l.063.03.154.076c1.357.703 2.33 1.77 2.918 3.198.278.679.418 1.388.421 2.126a5.655 5.655 0 01-.18 1.631.167.167 0 00.04.155 5.982 5.982 0 011.578 2.891c.385 1.901-.01 3.615-1.183 5.14l-.182.22a6.063 6.063 0 01-2.934 1.851.162.162 0 00-.108.102c-.255.736-.511 1.364-.987 1.992-1.199 1.582-2.962 2.462-4.948 2.451-1.583-.008-2.986-.587-4.21-1.736a.145.145 0 00-.14-.032c-.518.167-1.04.191-1.604.185a5.924 5.924 0 01-2.595-.622 6.058 6.058 0 01-2.146-1.781c-.203-.269-.404-.522-.551-.821a7.74 7.74 0 01-.495-1.283 6.11 6.11 0 01-.017-3.064.166.166 0 00.008-.074.115.115 0 00-.037-.064 5.958 5.958 0 01-1.38-2.202 5.196 5.196 0 01-.333-1.589 6.915 6.915 0 01.188-2.132c.45-1.484 1.309-2.648 2.577-3.493.282-.188.55-.334.802-.438.286-.12.573-.22.861-.304a.129.129 0 00.087-.087A6.016 6.016 0 015.635 2.31C6.315 1.464 7.132.846 8.086.457zm-.804 7.85a.848.848 0 00-1.473.842l1.694 2.965-1.688 2.848a.849.849 0 001.46.864l1.94-3.272a.849.849 0 00.007-.854l-1.94-3.393zm5.446 6.24a.849.849 0 000 1.695h4.848a.849.849 0 000-1.696h-4.848z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                url: "https://meter.chat/api/mcp",
                headers: { Authorization: `Bearer ${apiKey}` },
              },
            },
          },
          null,
          2
        ),
      },
    ],
  },
];

/* ─── Service Connectors ──────────────────────────────────────── */

const SERVICE_CONNECTORS = [
  { id: "github", name: "GitHub", type: "oauth" as const, icon: "M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z", desc: "repos, PRs & commits" },
  { id: "gmail", name: "Gmail", type: "oauth" as const, icon: "M20 4H4c-1.1 0-2 .9-2 2v12c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V6c0-1.1-.9-2-2-2zm0 4l-8 5-8-5V6l8 5 8-5v2z", desc: "read emails & receipts" },
  { id: "stripe", name: "Stripe", type: "oauth" as const, icon: "M13.976 9.15c-2.172-.806-3.356-1.426-3.356-2.409 0-.831.683-1.305 1.901-1.305 2.227 0 4.515.858 6.09 1.631l.89-5.494C18.252.975 15.697 0 12.165 0 9.667 0 7.589.654 6.104 1.872 4.56 3.147 3.757 4.992 3.757 7.218c0 4.039 2.467 5.76 6.476 7.219 2.585.92 3.445 1.574 3.445 2.583 0 .98-.84 1.545-2.354 1.545-1.875 0-4.965-.921-6.99-2.109l-.9 5.555C5.175 22.99 8.385 24 11.714 24c2.641 0 4.843-.624 6.328-1.813 1.664-1.305 2.525-3.236 2.525-5.732 0-4.128-2.524-5.851-6.591-7.305z", desc: "MRR, customers & churn" },
  { id: "posthog", name: "PostHog", type: "api_key" as const, icon: "M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5", desc: "DAUs, retention & funnels" },
];

function ServiceConnectors() {
  const activeSessionId = useMeterStore((s) => s.activeSessionId);
  const connectedServices = useMeterStore((s) => {
    const sess = s.sessions.find((p) => p.id === s.activeSessionId) ?? s.sessions[0];
    return sess?.connectedServices ?? {};
  });
  const [connecting, setConnecting] = useState<string | null>(null);
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);

  const handleOAuthConnect = (providerId: string) => {
    setConnecting(providerId);
    // Navigate directly — the authorize endpoint returns a redirect to the provider
    window.location.href = `/api/oauth/${providerId}/authorize?workspaceId=${encodeURIComponent(activeSessionId ?? "")}`;
  };

  const handleApiKeyConnect = async (providerId: string) => {
    if (!apiKeyInput.trim()) return;
    setConnecting(providerId);
    try {
      const res = await authFetch("/api/oauth/api-key", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ provider: providerId, apiKey: apiKeyInput.trim(), workspaceId: activeSessionId }),
      });
      if (res.ok) {
        useMeterStore.getState().connectService(providerId);
        setApiKeyInput("");
        setApiKeyProvider(null);
      }
    } catch { /* silent */ }
    setConnecting(null);
  };

  const handleDisconnect = async (providerId: string) => {
    try {
      await authFetch(`/api/oauth/${providerId}/disconnect?workspaceId=${encodeURIComponent(activeSessionId ?? "")}`, { method: "POST" });
      useMeterStore.getState().disconnectService(providerId);
    } catch { /* silent */ }
  };

  return (
    <div className="flex flex-col gap-2">
      <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground">Services</span>
      <div className="flex flex-col gap-1.5">
        {SERVICE_CONNECTORS.map((svc) => {
          const isConnected = !!connectedServices[svc.id];
          const isConnecting = connecting === svc.id;
          const showApiKeyForm = svc.type === "api_key" && apiKeyProvider === svc.id && !isConnected;

          if (showApiKeyForm) {
            return (
              <div key={svc.id} className="flex flex-col gap-1.5 rounded-lg border border-border p-2.5">
                <span className="font-sans text-[11px] text-muted-foreground/70">{svc.name} API Key</span>
                <input
                  type="password"
                  value={apiKeyInput}
                  onChange={(e) => setApiKeyInput(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") handleApiKeyConnect(svc.id); if (e.key === "Escape") { setApiKeyProvider(null); setApiKeyInput(""); } }}
                  placeholder="phx_..."
                  autoFocus
                  className="rounded bg-foreground/[0.04] px-2.5 py-1.5 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/40 outline-none"
                />
                <div className="flex gap-1.5">
                  <button onClick={() => handleApiKeyConnect(svc.id)} disabled={isConnecting} className="flex-1 rounded bg-foreground/10 px-2.5 py-1 font-sans text-[11px] text-foreground hover:bg-foreground/15 transition-colors disabled:opacity-50">
                    {isConnecting ? "..." : "Save"}
                  </button>
                  <button onClick={() => { setApiKeyProvider(null); setApiKeyInput(""); }} className="rounded px-2.5 py-1 font-sans text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors">
                    Cancel
                  </button>
                </div>
              </div>
            );
          }

          return (
            <div key={svc.id} className="flex items-center gap-2.5 rounded-lg border border-border px-3 py-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0 text-muted-foreground/60">
                <path d={svc.icon} />
              </svg>
              <span className="flex-1 font-sans text-[12px] text-foreground/80">{svc.name}</span>
              {isConnected ? (
                <div className="flex items-center gap-2">
                  <span className="flex items-center gap-1.5 font-sans text-[11px] text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    Connected
                  </span>
                  <button onClick={() => handleDisconnect(svc.id)} className="font-mono text-[10px] text-muted-foreground/40 hover:text-red-400 transition-colors">
                    ×
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => svc.type === "oauth" ? handleOAuthConnect(svc.id) : setApiKeyProvider(svc.id)}
                  disabled={isConnecting}
                  className="rounded-md border border-border px-2.5 py-1 font-sans text-[11px] text-muted-foreground/70 hover:text-foreground hover:border-foreground/10 transition-colors disabled:opacity-50"
                >
                  {isConnecting ? "..." : "Connect"}
                </button>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

/* ─── Connect Tab ──────────────────────────────────────────────── */

function ConnectTab() {
  const { userId } = useMeterStore();
  const workspaceCardReady = useMeterStore(selectWorkspaceCardReady);
  const [apiKey, setApiKey] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [revealed, setRevealed] = useState(false);
  const [copied, setCopied] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [copiedSnippet, setCopiedSnippet] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch existing MCP API key
  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetch("/api/mcp-key");
        if (res.ok) {
          const data = await res.json();
          if (!cancelled) setApiKey(data.key ?? null);
        } else {
          const data = await res.json().catch(() => ({}));
          if (!cancelled) setError(data.error ?? `Failed to load key (${res.status})`);
        }
      } catch (err) {
        if (!cancelled) setError("Network error loading key");
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [userId]);

  const generateKey = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/mcp-key", { method: "POST" });
      const data = await res.json();
      if (res.ok) {
        setApiKey(data.key);
        setRevealed(true);
      } else {
        setError(data.error ?? `Failed to generate key (${res.status})`);
      }
    } catch (err) {
      setError("Network error generating key");
    } finally {
      setLoading(false);
    }
  };

  const copyKey = () => {
    if (!apiKey) return;
    navigator.clipboard.writeText(apiKey);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const copySnippetText = (connectorId: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedSnippet(connectorId);
    setTimeout(() => setCopiedSnippet(null), 2000);
  };

  const maskedKey = apiKey
    ? `${apiKey.slice(0, 7)}${"•".repeat(16)}${apiKey.slice(-4)}`
    : "";
  const displayKey = revealed ? apiKey ?? "" : maskedKey;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div>
        <h3 className="font-sans text-xs uppercase tracking-wider text-foreground mb-1">
          Connect to your tools
        </h3>
        <p className="font-sans text-xs text-muted-foreground leading-relaxed">
          Hook Meter into your coding agents via MCP. Your decisions, blueprints, and debates — available in your IDE.
        </p>
      </div>

      {/* API Key Section */}
      <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground">
            API Key
          </span>
          {apiKey && (
            <button
              onClick={() => setRevealed(!revealed)}
              className="font-sans text-xs text-muted-foreground hover:text-foreground transition-colors"
            >
              {revealed ? "Hide" : "Reveal"}
            </button>
          )}
        </div>

        {loading && !apiKey ? (
          <div className="h-9 rounded-md bg-foreground/5 animate-pulse" />
        ) : apiKey ? (
          <div className="flex items-center gap-2">
            <div className="flex-1 rounded-md bg-foreground/5 px-3 py-2 font-mono text-xs text-foreground/90 overflow-hidden text-ellipsis whitespace-nowrap select-all">
              {displayKey}
            </div>
            <button
              onClick={copyKey}
              className="shrink-0 rounded-md border border-border px-2.5 py-2 font-sans text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        ) : (
          <button
            onClick={generateKey}
            disabled={loading || !workspaceCardReady}
            title={!workspaceCardReady ? "Complete onboarding first" : undefined}
            className="rounded-md border border-border px-3 py-2 font-sans text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? "Generating..." : "Generate API Key"}
          </button>
        )}
        {error && (
          <p className="font-sans text-xs text-red-400 mt-1">{error}</p>
        )}
      </div>

      {/* Services: GitHub, Gmail, Stripe, PostHog */}
      <ServiceConnectors />

      {/* Connectors */}
      <div className="flex flex-col gap-2">
        <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground">
          Connectors
        </span>

        <div className="grid grid-cols-2 gap-2">
          {MCP_CONNECTORS.map((connector) => {
            const isExpanded = expandedId === connector.id;
            return (
              <button
                key={connector.id}
                onClick={() => setExpandedId(isExpanded ? null : connector.id)}
                className={`flex items-center gap-2 rounded-lg border px-3 py-2.5 font-sans text-xs transition-colors ${
                  isExpanded
                    ? "border-foreground/20 bg-foreground/5 text-foreground"
                    : "border-border text-muted-foreground hover:text-foreground hover:border-foreground/10"
                }`}
              >
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 24 24"
                  fill="currentColor"
                  fillRule="evenodd"
                  clipRule="evenodd"
                  className="shrink-0"
                >
                  <path d={connector.icon} />
                </svg>
                {connector.name}
              </button>
            );
          })}
        </div>

        {/* Expanded connector instructions */}
        {expandedId && apiKey && (() => {
          const connector = MCP_CONNECTORS.find((c) => c.id === expandedId);
          if (!connector) return null;
          const steps = connector.instructions(apiKey);
          return (
            <div className="mt-1 rounded-lg border border-border bg-card overflow-hidden">
              {steps.map((step, i) => (
                <div key={i} className="p-3 flex flex-col gap-2">
                  <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground">
                    {step.label}
                  </span>
                  <div className="relative">
                    <pre className="rounded-md bg-foreground/5 p-3 font-mono text-xs text-foreground/80 overflow-x-auto whitespace-pre-wrap break-all leading-relaxed">
                      {step.snippet}
                    </pre>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        copySnippetText(connector.id, step.snippet);
                      }}
                      className="absolute top-2 right-2 rounded-md border border-border bg-card px-2 py-1 font-sans text-xs uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
                    >
                      {copiedSnippet === connector.id ? "Copied" : "Copy"}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          );
        })()}

        {expandedId && !apiKey && (
          <div className="mt-1 rounded-lg border border-border bg-card p-3">
            <p className="font-sans text-xs text-muted-foreground">
              Generate an API key above to see setup instructions.
            </p>
          </div>
        )}
      </div>

      {/* What you get */}
      <div className="flex flex-col gap-2">
        <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground">
          Available tools
        </span>
        <div className="rounded-lg border border-border bg-card p-3 flex flex-col gap-1.5">
          {[
            ["get_decisions", "Search your decision log"],
            ["get_blueprints", "Fetch your blueprints"],
            ["get_debates", "Browse debate summaries"],
            ["search", "Full-text search across everything"],
          ].map(([name, desc]) => (
            <div key={name} className="flex items-start gap-2">
              <code className="font-mono text-xs text-blue-400 bg-blue-400/10 rounded px-1 py-0.5 shrink-0">
                {name}
              </code>
              <span className="font-sans text-xs text-muted-foreground">
                {desc}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

/* ─── Decisions Tab ────────────────────────────────────────────── */

function DecisionsTab({ activeSessionId: rawSessionId }: { activeSessionId: string | null }) {
  const { decisions } = useDecisionsStore();

  // Resolve subtrack → parent workspace so decisions are scoped to workspace
  const wsTracks = useWorkspaceStore((s) => s.tracks);
  const wsWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const meterSessions = useMeterStore((s) => s.sessions);
  const activeSessionId = useMemo(() => {
    if (!rawSessionId) return null;
    const wsTrack = wsTracks.find((p) => p.id === rawSessionId);
    if (wsTrack?.isSubtrack) {
      const workspace = wsWorkspaces.find((c) => c.id === wsTrack.workspaceId);
      if (workspace?.sessionId) {
        const parent = meterSessions.find((p) => p.id === workspace.sessionId);
        if (parent) return parent.id;
      }
    }
    return rawSessionId;
  }, [rawSessionId, wsTracks, wsWorkspaces, meterSessions]);

  // Only show decisions scoped to the active workspace
  const allDecisions = decisions.filter((d) => !d.archived);
  const allVisible = allDecisions
    .filter((d) => d.sessionId === activeSessionId)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "undecided" ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });

  // Group by category
  const grouped = useMemo(() => {
    const map = new Map<string, Decision[]>();
    for (const d of allVisible) {
      const cat = d.category || "other";
      if (!map.has(cat)) map.set(cat, []);
      map.get(cat)!.push(d);
    }
    return [...map.entries()].sort(
      (a, b) => CATEGORY_ORDER.indexOf(a[0]) - CATEGORY_ORDER.indexOf(b[0])
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [decisions, activeSessionId]);

  // Datasheets
  const { datasheets, fetchDatasheets } = useDatasheetsStore();
  const [expandedDsId, setExpandedDsId] = useState<string | null>(null);

  useEffect(() => {
    fetchDatasheets(activeSessionId);
  }, [activeSessionId, fetchDatasheets]);

  const sessionDatasheets = datasheets.filter((ds) => ds.sessionId === activeSessionId || ds.sessionId === rawSessionId);

  return (
    <div className="flex flex-col gap-4">
      <PinsSection activeSessionId={activeSessionId} />

      {/* Datasheets */}
      {sessionDatasheets.length > 0 && (
        <div className="flex flex-col gap-1">
          <span className="font-sans text-[11px] text-muted-foreground/60 uppercase tracking-wider px-1">Datasheets</span>
          {sessionDatasheets.map((ds) => (
            <div key={ds.id} className="group">
              <button
                onClick={() => setExpandedDsId(expandedDsId === ds.id ? null : ds.id)}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left hover:bg-foreground/[0.03] transition-colors"
              >
                <div className="flex items-center gap-2">
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/50">
                    <rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /><line x1="9" y1="3" x2="9" y2="21" />
                  </svg>
                  <span className="font-sans text-[12px] text-foreground/80">{ds.title}</span>
                </div>
                <span className="font-mono text-[10px] text-muted-foreground/50">{ds.rows.length} rows</span>
              </button>
              {expandedDsId === ds.id && (
                <div className="mx-2 mb-2 overflow-x-auto rounded border border-border/30">
                  <table className="w-full text-[11px]">
                    <thead>
                      <tr className="border-b border-border/30 bg-foreground/[0.02]">
                        {ds.columns.map((col) => (
                          <th key={col} className="px-2 py-1 text-left font-mono font-medium text-muted-foreground/70 whitespace-nowrap">{col}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody>
                      {ds.rows.map((row, ri) => (
                        <tr key={ri} className="border-b border-border/20">
                          {ds.columns.map((col) => (
                            <td key={col} className="px-2 py-1 font-mono text-foreground/70 whitespace-nowrap">{row[col] || "—"}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Decisions */}
      {allVisible.length === 0 && sessionDatasheets.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <span className="font-sans text-xs text-muted-foreground/70">
            No memories yet
          </span>
          <span className="font-sans text-xs text-muted-foreground/60">
            Decisions and datasheets are logged as you chat
          </span>
        </div>
      ) : allVisible.length > 0 ? (
        <div className="flex flex-col gap-1">
          {sessionDatasheets.length > 0 && <span className="font-sans text-[11px] text-muted-foreground/60 uppercase tracking-wider px-1 mt-2">Decisions</span>}
          {grouped.map(([category, categoryDecisions]) => (
            <CategoryGroup key={category} category={category} decisions={categoryDecisions} />
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─── BLUEPRINT TAB ─── */
function formatArtifactTime(ts?: number) {
  if (!ts) return "";
  const d = new Date(ts);
  const now = new Date();
  const diffMs = now.getTime() - d.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins}m ago`;
  const diffHrs = Math.floor(diffMins / 60);
  if (diffHrs < 24) return `${diffHrs}h ago`;
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

const CATEGORY_LABELS: Record<string, string> = {
  strategy: "Strategy",
  technical: "Technical",
  business: "Business",
  design: "Design",
  notes: "Notes",
  other: "Other",
};

const CATEGORY_ICONS: Record<string, React.ReactNode> = {
  strategy: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-blue-400/60">
      <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
    </svg>
  ),
  technical: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-emerald-400/60">
      <polyline points="16 18 22 12 16 6" /><polyline points="8 6 2 12 8 18" />
    </svg>
  ),
  business: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-amber-400/60">
      <line x1="12" y1="1" x2="12" y2="23" /><path d="M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
    </svg>
  ),
  design: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-purple-400/60">
      <circle cx="13.5" cy="6.5" r="0.5" fill="currentColor" /><circle cx="17.5" cy="10.5" r="0.5" fill="currentColor" /><circle cx="8.5" cy="7.5" r="0.5" fill="currentColor" /><circle cx="6.5" cy="12.5" r="0.5" fill="currentColor" />
      <path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.926 0 1.648-.746 1.648-1.688 0-.437-.18-.835-.437-1.125-.29-.289-.438-.652-.438-1.125a1.64 1.64 0 0 1 1.668-1.668h1.996c3.051 0 5.555-2.503 5.555-5.554C21.965 6.012 17.461 2 12 2z" />
    </svg>
  ),
  notes: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/80">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  other: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/80">
      <path d="M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9z" /><polyline points="13 2 13 9 20 9" />
    </svg>
  ),
};

function inferCategoryFromPath(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (/readme|architecture|decisions|claude|cursorrules/.test(lower)) return "strategy";
  if (/api|schema|spec|config|setup/.test(lower)) return "technical";
  if (/design|brand|style|ui|ux/.test(lower)) return "design";
  if (/budget|revenue|runway|pitch|investor|business/.test(lower)) return "business";
  if (/notes|meeting|standup|retro|log/.test(lower)) return "notes";
  return "other";
}

function DocumentTree({ artifacts, onOpen }: {
  artifacts: Artifact[];
  onOpen: () => void;
}) {
  const [collapsedCategories, setCollapsedCategories] = useState<Set<string>>(new Set());

  // Group artifacts by category
  const grouped = useMemo(() => {
    const groups: Record<string, Artifact[]> = {};
    for (const a of artifacts) {
      const cat = a.category || inferCategoryFromPath(a.filePath);
      if (!groups[cat]) groups[cat] = [];
      groups[cat].push(a);
    }
    // Sort: strategy first, then alphabetical
    const order = ["strategy", "technical", "design", "business", "notes", "other"];
    return order
      .filter((cat) => groups[cat]?.length)
      .map((cat) => ({ category: cat, items: groups[cat] }));
  }, [artifacts]);

  const toggleCategory = (cat: string) => {
    setCollapsedCategories((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  };

  return (
    <div className="flex flex-col gap-1">
      {grouped.map(({ category, items }) => {
        const collapsed = collapsedCategories.has(category);
        return (
          <div key={category}>
            {/* Category folder header */}
            <button
              onClick={() => toggleCategory(category)}
              className="flex w-full items-center gap-1.5 py-1 px-1 rounded hover:bg-foreground/[0.03] transition-colors"
            >
              <svg
                width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                className={`shrink-0 text-muted-foreground/70 transition-transform ${collapsed ? "" : "rotate-90"}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other}
              <span className="font-sans text-xs text-muted-foreground/70 uppercase tracking-wider">
                {CATEGORY_LABELS[category] ?? category}
              </span>
              <span className="font-sans text-xs text-muted-foreground/60">
                {items.length}
              </span>
            </button>

            {/* Files under this category */}
            {!collapsed && (
              <div className="ml-3 border-l border-border/40 pl-1.5">
                {items.map((a) => (
                  <ArtifactRow
                    key={a.id}
                    artifact={a}
                    onOpen={onOpen}
                  />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function ArtifactRow({ artifact, onOpen }: {
  artifact: Artifact;
  onOpen: () => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    if (!artifact.content) return;
    await navigator.clipboard.writeText(artifact.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <div className="rounded-md transition-colors">
      <div
        className="group relative flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-foreground/[0.02]"
        onClick={() => setExpanded(!expanded)}
      >
        <svg
          width="12"
          height="12"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`shrink-0 text-muted-foreground/70 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/80">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="flex-1 truncate font-sans text-xs text-foreground/80">
          {artifact.filePath}
        </span>
        <div className="absolute right-1 flex items-center gap-1 rounded bg-background/90 opacity-0 group-hover:opacity-100 pointer-events-none group-hover:pointer-events-auto transition-opacity">
          <button
            onClick={handleCopy}
            className="rounded px-1.5 py-0.5 font-sans text-xs text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            {copied ? "copied" : "copy"}
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation();
              if (!artifact.content) return;
              const blob = new Blob([artifact.content], { type: "text/plain" });
              const url = URL.createObjectURL(blob);
              const link = document.createElement("a");
              link.href = url;
              link.download = artifact.filePath.split("/").pop() ?? artifact.filePath;
              link.click();
              URL.revokeObjectURL(url);
            }}
            className="rounded px-1.5 py-0.5 font-sans text-xs text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            download
          </button>
        </div>
      </div>

      {expanded && (
        <div className="ml-6 mr-1 mb-2 mt-0.5 flex flex-col gap-1.5 border-l border-border/40 pl-3">
          {artifact.lastGeneratedAt && (
            <span className="font-sans text-xs text-muted-foreground/70">
              Generated {formatArtifactTime(artifact.lastGeneratedAt)}
            </span>
          )}
          {artifact.content && (
            <pre className="overflow-y-auto rounded bg-foreground/[0.03] p-2 font-mono text-xs text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
              {artifact.content}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

function InputsTab({ activeSessionId: rawSessionId }: { activeSessionId: string | null }) {
  // Resolve subtrack → parent workspace
  const wsTracks = useWorkspaceStore((s) => s.tracks);
  const wsWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const meterSessions = useMeterStore((s) => s.sessions);
  const selectedModelId = useMeterStore((s) => s.selectedModelId);
  const connectedServices = useMeterStore((s) => {
    const sess = s.sessions.find((p) => p.id === s.activeSessionId) ?? s.sessions[0];
    return sess?.connectedServices ?? {};
  });
  const activeSessionId = useMemo(() => {
    if (!rawSessionId) return null;
    const wsTrack = wsTracks.find((p) => p.id === rawSessionId);
    if (wsTrack?.isSubtrack) {
      const workspace = wsWorkspaces.find((c) => c.id === wsTrack.workspaceId);
      if (workspace?.sessionId) {
        const parent = meterSessions.find((p) => p.id === workspace.sessionId);
        if (parent) return parent.id;
      }
    }
    return rawSessionId;
  }, [rawSessionId, wsTracks, wsWorkspaces, meterSessions]);

  const { inputs, loading, uploading, fetchInputs, addInput, removeInput, toggleInput, setUploading } = useInputsStore();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [showBranding, setShowBranding] = useState(false);
  const [showSystemPrompt, setShowSystemPrompt] = useState(false);
  const [showDocuments, setShowDocuments] = useState(true);
  const [showServices, setShowServices] = useState(false);
  const [showConversation, setShowConversation] = useState(false);
  const [showResetConfirm, setShowResetConfirm] = useState(false);

  useEffect(() => {
    fetchInputs(activeSessionId);
  }, [activeSessionId, fetchInputs]);

  const handleUpload = async (files: FileList | File[]) => {
    if (!activeSessionId) return;
    setUploading(true);
    for (const file of Array.from(files)) {
      try {
        const form = new FormData();
        form.append("file", file);
        form.append("sessionId", activeSessionId);
        const res = await authFetch("/api/inputs/upload", { method: "POST", body: form });
        if (res.ok) {
          const data = await res.json();
          addInput(data);
        }
      } catch { /* silent */ }
    }
    setUploading(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files.length > 0) handleUpload(e.dataTransfer.files);
  };

  // Token estimation helpers
  const estTokens = (text: string | null | undefined) => text ? Math.ceil(text.length / 4) : 0;
  const fmtTokens = (t: number) => t < 1000 ? `${t}` : t < 10000 ? `${(t / 1000).toFixed(1)}k` : `${Math.round(t / 1000)}k`;

  // Context window computation
  const model = getModel(selectedModelId === "auto" ? "openai/gpt-5.4" : selectedModelId);
  const contextWindow = model.contextWindow ?? 200_000;
  const systemPromptTokens = 2_500; // base instructions (stable)
  const connectedServiceIds = Object.keys(connectedServices).filter((k) => connectedServices[k]);
  const connectorTokens = connectedServiceIds.length * 200; // ~200 tokens per service
  const enabledInputs = inputs.filter((i) => i.enabled);
  const documentTokens = enabledInputs.reduce((sum, i) => sum + estTokens(i.contentText), 0);
  const activeSession = meterSessions.find((p) => p.id === (activeSessionId ?? rawSessionId));
  const messages = activeSession?.messages ?? [];
  const conversationTokens = Math.min(
    messages.reduce((sum, m) => sum + estTokens(m.content) + 4, 0),
    30_000, // MAX_CONTEXT_TOKENS cap
  );
  const totalTokens = systemPromptTokens + connectorTokens + documentTokens + conversationTokens;
  const utilization = Math.min(100, (totalTokens / contextWindow) * 100);

  const fileIcon = (mimeType: string) => {
    if (mimeType.startsWith("image/")) return "M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z";
    if (mimeType === "application/pdf") return "M7 21h10a2 2 0 002-2V9.414a1 1 0 00-.293-.707l-5.414-5.414A1 1 0 0012.586 3H7a2 2 0 00-2 2v14a2 2 0 002 2z";
    if (mimeType.includes("json") || mimeType.includes("yaml") || mimeType.includes("xml")) return "M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4";
    return "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z";
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12">
        <div className="h-4 w-4 animate-spin rounded-full border-2 border-foreground/20 border-t-foreground/60" />
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* ── Context window header ── */}
      <div className="rounded-lg border border-border/50 p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[12px] text-foreground/90">~{fmtTokens(totalTokens)} / {fmtTokens(contextWindow)}</span>
          <span className="font-mono text-[11px] text-muted-foreground/70">{model.name}</span>
        </div>
        <div className="h-1.5 rounded-full bg-foreground/[0.08] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-300 ${utilization > 80 ? "bg-amber-500" : "bg-emerald-500/70"}`}
            style={{ width: `${Math.max(1, utilization)}%` }}
          />
        </div>
      </div>

      {/* ── Branding ── */}
      <div className="flex flex-col">
        <button onClick={() => setShowBranding(!showBranding)} className="flex items-center justify-between py-2 text-left rounded-md hover:bg-foreground/[0.03] px-1 transition-colors">
          <div className="flex items-center gap-2">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted-foreground/50 transition-transform ${showBranding ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="font-sans text-[12px] text-foreground/80">Branding</span>
          </div>
        </button>
        {showBranding && (() => {
          const iconInput = inputs.find((i) => i.mimeType.startsWith("image/") && i.fileName.toLowerCase().includes("icon"));
          const logoInput = inputs.find((i) => i.mimeType.startsWith("image/") && i.fileName.toLowerCase().includes("logo") && !i.fileName.toLowerCase().includes("icon"));
          const uploadBrand = async (prefix: string, file: File) => {
            if (!activeSessionId) return;
            const named = new File([file], `${prefix}-${file.name}`, { type: file.type });
            setUploading(true);
            try {
              const form = new FormData();
              form.append("file", named);
              form.append("sessionId", activeSessionId);
              const res = await authFetch("/api/inputs/upload", { method: "POST", body: form });
              if (res.ok) addInput(await res.json());
            } catch { /* silent */ }
            setUploading(false);
          };
          return (
            <div className="flex flex-col gap-3 pl-5 pb-2">
              {/* Icon */}
              <div className="flex flex-col gap-1.5">
                <span className="font-sans text-[11px] text-muted-foreground/60">Icon (favicon)</span>
                {iconInput ? (
                  <div className="flex items-center gap-3">
                    <img src={iconInput.publicUrl} alt="Icon" className="h-6 w-6 rounded" />
                    <button onClick={() => removeInput(iconInput.id)} className="font-mono text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors">Replace</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 rounded-md border border-dashed border-border/30 px-2.5 py-1.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors w-fit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><rect x="3" y="3" width="18" height="18" rx="2" /><path d="M12 8v8M8 12h8" /></svg>
                    <span className="font-sans text-[11px] text-muted-foreground/50">Upload icon</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadBrand("icon", e.target.files[0]); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              {/* Logo */}
              <div className="flex flex-col gap-1.5">
                <span className="font-sans text-[11px] text-muted-foreground/60">Logo (full)</span>
                {logoInput ? (
                  <div className="flex items-center gap-3">
                    <img src={logoInput.publicUrl} alt="Logo" className="h-8 w-auto rounded" />
                    <button onClick={() => removeInput(logoInput.id)} className="font-mono text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors">Replace</button>
                  </div>
                ) : (
                  <label className="flex items-center gap-2 rounded-md border border-dashed border-border/30 px-2.5 py-1.5 cursor-pointer hover:bg-foreground/[0.02] transition-colors w-fit">
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/40"><rect x="3" y="3" width="18" height="18" rx="2" ry="2" /><circle cx="8.5" cy="8.5" r="1.5" /><polyline points="21 15 16 10 5 21" /></svg>
                    <span className="font-sans text-[11px] text-muted-foreground/50">Upload logo</span>
                    <input type="file" accept="image/*" className="hidden" onChange={(e) => { if (e.target.files?.[0]) uploadBrand("logo", e.target.files[0]); e.target.value = ""; }} />
                  </label>
                )}
              </div>
              <p className="font-sans text-[10px] text-muted-foreground/40 leading-relaxed">Icon is used as favicon. Logo replaces workspace title in docs header.</p>
            </div>
          );
        })()}
      </div>

      {/* ── System Instructions ── */}
      <div className="flex flex-col">
        <button onClick={() => setShowSystemPrompt(!showSystemPrompt)} className="flex items-center justify-between py-2 text-left rounded-md hover:bg-foreground/[0.03] px-1 transition-colors">
          <div className="flex items-center gap-2">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted-foreground/50 transition-transform ${showSystemPrompt ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="font-sans text-[12px] text-foreground/80">System Instructions</span>
          </div>
          <span className="font-mono text-[11px] text-muted-foreground/50">~{fmtTokens(systemPromptTokens)}</span>
        </button>
        {showSystemPrompt && (
          <pre className="max-h-60 overflow-auto rounded bg-foreground/[0.03] p-3 font-mono text-[11px] text-foreground/60 whitespace-pre-wrap break-words leading-relaxed ml-5">
            {SYSTEM_PROMPT.slice(0, 2000)}{SYSTEM_PROMPT.length > 2000 ? "\n\n[...truncated]" : ""}
          </pre>
        )}
      </div>

      {/* ── Documents ── */}
      <div className="flex flex-col">
        <button onClick={() => setShowDocuments(!showDocuments)} className="flex items-center justify-between py-2 text-left rounded-md hover:bg-foreground/[0.03] px-1 transition-colors">
          <div className="flex items-center gap-2">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted-foreground/50 transition-transform ${showDocuments ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="font-sans text-[12px] text-foreground/80">Documents</span>
            {documentTokens > 0 && <span className="font-mono text-[10px] text-muted-foreground/50">~{fmtTokens(documentTokens)}</span>}
          </div>
          <button onClick={(e) => { e.stopPropagation(); fileInputRef.current?.click(); }} className="font-mono text-[10px] text-muted-foreground/50 hover:text-foreground transition-colors">+ Upload</button>
          <input ref={fileInputRef} type="file" multiple className="hidden" onChange={(e) => { if (e.target.files?.length) handleUpload(e.target.files); e.target.value = ""; }} />
        </button>
        {showDocuments && (<div className="pl-5">

        {uploading && (
          <div className="flex items-center gap-2 py-1">
            <div className="h-3 w-3 animate-spin rounded-full border border-foreground/20 border-t-foreground/60" />
            <span className="font-mono text-[10px] text-muted-foreground/50">Uploading...</span>
          </div>
        )}

        {inputs.length === 0 ? (
          <div
            className={`flex flex-col items-center rounded-lg border border-dashed py-8 text-center transition-colors ${
              dragOver ? "border-foreground/30 bg-foreground/[0.03]" : "border-border/30"
            }`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/30 mb-2">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4" /><polyline points="17 8 12 3 7 8" /><line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-[11px] text-muted-foreground/40">Drop files to add context</p>
          </div>
        ) : (
          <div
            className={`flex flex-col gap-0.5 ${dragOver ? "rounded-lg border border-dashed border-foreground/30 bg-foreground/[0.02] p-1" : ""}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={handleDrop}
          >
            {inputs.map((input) => {
              const isExpanded = expandedId === input.id;
              const tokens = estTokens(input.contentText);
              return (
                <div key={input.id} className={`group rounded-md transition-colors ${input.enabled ? "" : "opacity-40"}`}>
                  <div className="flex w-full items-center gap-2 px-1 py-1.5">
                    <button
                      onClick={() => toggleInput(input.id)}
                      className={`shrink-0 h-3.5 w-6 rounded-full transition-colors ${input.enabled ? "bg-emerald-500" : "bg-foreground/20"}`}
                    >
                      <div className={`h-2.5 w-2.5 rounded-full bg-white transition-transform ${input.enabled ? "translate-x-3" : "translate-x-0.5"}`} />
                    </button>
                    <button
                      onClick={() => setExpandedId(isExpanded ? null : input.id)}
                      className="flex flex-1 items-center gap-1.5 min-w-0 text-left"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/60">
                        <path d={fileIcon(input.mimeType)} />
                      </svg>
                      <span className="flex-1 truncate font-mono text-[11px] text-foreground/80">{input.fileName}</span>
                      {tokens > 0 && <span className="shrink-0 font-mono text-[10px] text-muted-foreground/50">~{fmtTokens(tokens)}</span>}
                    </button>
                    <button
                      onClick={() => removeInput(input.id)}
                      className="shrink-0 opacity-0 group-hover:opacity-100 rounded p-0.5 text-muted-foreground/40 hover:text-red-400 transition-all"
                    >
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                        <line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                  {isExpanded && (
                    <div className="ml-7 mt-0.5 mb-1.5 border-l border-border/30 pl-2.5">
                      <span className="font-mono text-[9px] text-muted-foreground/35">{new Date(input.createdAt).toLocaleString()}</span>
                      {input.contentText && (
                        <pre className="mt-1 max-h-40 overflow-auto rounded bg-foreground/[0.02] p-1.5 font-mono text-[10px] text-foreground/60 whitespace-pre-wrap break-words">
                          {input.contentText.slice(0, 5000)}{input.contentText.length > 5000 ? "\n..." : ""}
                        </pre>
                      )}
                      {input.mimeType.startsWith("image/") && (
                        <img src={input.publicUrl} alt={input.fileName} className="mt-1 max-h-40 rounded border border-border/20" />
                      )}
                      {input.mimeType === "application/pdf" && (
                        <a href={input.publicUrl} target="_blank" rel="noopener noreferrer" className="mt-1 inline-flex items-center gap-1 font-mono text-[10px] text-blue-400 hover:text-blue-300 transition-colors">
                          Open PDF
                        </a>
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
      )}
      </div>

      {/* ── Connected Services ── */}
      {connectedServiceIds.length > 0 && (
        <div className="flex flex-col">
          <button onClick={() => setShowServices(!showServices)} className="flex items-center justify-between py-2 text-left rounded-md hover:bg-foreground/[0.03] px-1 transition-colors">
            <div className="flex items-center gap-2">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted-foreground/50 transition-transform ${showServices ? "rotate-90" : ""}`}>
                <polyline points="9 18 15 12 9 6" />
              </svg>
              <span className="font-sans text-[12px] text-foreground/80">Connected Services</span>
            </div>
            <span className="font-mono text-[10px] text-muted-foreground/50">~{fmtTokens(connectorTokens)}</span>
          </button>
          {showServices && (
            <div className="flex flex-wrap gap-1.5 pl-5 pb-2">
              {connectedServiceIds.map((id) => (
                <span key={id} className="rounded-full bg-foreground/[0.06] px-2.5 py-0.5 font-mono text-[11px] text-muted-foreground/70 capitalize">{id}</span>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Conversation ── */}
      <div className="flex flex-col">
        <button onClick={() => setShowConversation(!showConversation)} className="flex items-center justify-between py-2 text-left rounded-md hover:bg-foreground/[0.03] px-1 transition-colors">
          <div className="flex items-center gap-2">
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className={`shrink-0 text-muted-foreground/50 transition-transform ${showConversation ? "rotate-90" : ""}`}>
              <polyline points="9 18 15 12 9 6" />
            </svg>
            <span className="font-sans text-[12px] text-foreground/80">Conversation</span>
            <span className="font-mono text-[10px] text-muted-foreground/50">{messages.length} messages</span>
          </div>
          <span className="font-mono text-[10px] text-muted-foreground/50">~{fmtTokens(conversationTokens)} / 30k</span>
        </button>
        {showConversation && messages.length > 0 && (
          <div className="flex flex-col gap-1 max-h-60 overflow-y-auto rounded bg-foreground/[0.02] p-2 ml-5">
            {messages.slice(-20).map((m) => (
              <div key={m.id} className="flex gap-2 py-0.5">
                <span className={`shrink-0 font-mono text-[10px] ${m.role === "user" ? "text-blue-400/70" : "text-emerald-400/70"}`}>
                  {m.role === "user" ? "You" : "AI"}
                </span>
                <span className="font-mono text-[10px] text-foreground/50 truncate">{m.content?.slice(0, 80) || "..."}</span>
              </div>
            ))}
            {messages.length > 20 && (
              <span className="font-mono text-[10px] text-muted-foreground/40 text-center py-1">+{messages.length - 20} older messages</span>
            )}
          </div>
        )}
      </div>

      {/* ── Reset Context ── */}
      {messages.length > 0 && (
        <div className="border-t border-border/30 pt-3 mt-1">
          <button
            onClick={() => setShowResetConfirm(true)}
            className="flex items-center gap-2 rounded-md px-2 py-1.5 font-mono text-[11px] text-muted-foreground/60 hover:text-red-400 hover:bg-red-500/[0.05] transition-colors"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="1 4 1 10 7 10" /><path d="M3.51 15a9 9 0 102.13-9.36L1 10" />
            </svg>
            Clear context &amp; start fresh
          </button>
        </div>
      )}

      {/* Reset confirmation modal */}
      {showResetConfirm && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-background/80 backdrop-blur-sm" onClick={() => setShowResetConfirm(false)}>
          <div className="rounded-xl border border-border bg-card p-6 shadow-xl max-w-sm mx-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-sans text-sm font-medium text-foreground mb-2">Clear context window?</h3>
            <p className="font-sans text-xs text-muted-foreground/80 mb-4 leading-relaxed">
              This will remove all messages from this workspace. Input documents and workspace settings are kept. A divider will appear in chat marking the reset.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setShowResetConfirm(false)}
                className="rounded-md px-3 py-1.5 font-sans text-xs text-muted-foreground/70 hover:text-foreground transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={() => {
                  if (activeSessionId) {
                    // Add a divider message before clearing
                    useMeterStore.getState().addMessage({
                      id: `ctx-clear-${Date.now().toString(36)}`,
                      role: "assistant",
                      content: "",
                      timestamp: Date.now(),
                      hidden: true,
                      isForkPoint: true,
                      forkResolution: "closed",
                    }, activeSessionId);
                    // Clear all messages except the divider
                    useMeterStore.setState((s) => ({
                      sessions: s.sessions.map((sess) =>
                        sess.id === activeSessionId
                          ? { ...sess, messages: [{ id: `ctx-clear-${Date.now().toString(36)}`, role: "assistant" as const, content: "Context window cleared. Starting fresh.", timestamp: Date.now() }] }
                          : sess
                      ),
                    }));
                  }
                  setShowResetConfirm(false);
                }}
                className="rounded-md bg-red-500/10 border border-red-500/20 px-3 py-1.5 font-sans text-xs text-red-400 hover:bg-red-500/20 transition-colors"
              >
                Clear context
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function PushToGitHubButton({ activeSessionId, artifacts }: { activeSessionId: string | null; artifacts: Artifact[] }) {
  const connectedServices = useMeterStore((s) => {
    const sess = s.sessions.find((p) => p.id === s.activeSessionId) ?? s.sessions[0];
    return sess?.connectedServices ?? {};
  });
  const isGitHubConnected = !!connectedServices["github"];
  const [pushing, setPushing] = useState(false);
  const [repoInput, setRepoInput] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  const handlePush = async () => {
    if (!repoInput.includes("/") || !activeSessionId) return;
    setPushing(true);
    setResult(null);
    try {
      const branchName = `meter/${Date.now().toString(36)}`;
      const res = await authFetch("/api/artifacts/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          artifactIds: artifacts.map((a) => a.id),
          repo: repoInput.trim(),
          workspaceId: activeSessionId,
          branch: branchName,
        }),
      });
      if (res.ok) {
        setResult({ ok: true, message: `Pushed to branch ${branchName}` });
        setShowForm(false);
      } else {
        const data = await res.json().catch(() => ({}));
        setResult({ ok: false, message: data.error ?? "Push failed" });
      }
    } catch {
      setResult({ ok: false, message: "Push failed" });
    }
    setPushing(false);
  };

  if (!isGitHubConnected) {
    return (
      <p className="font-sans text-xs text-muted-foreground/50">
        Connect GitHub in the Connect tab to push outputs to a repo.
      </p>
    );
  }

  return (
    <div className="flex flex-col gap-2">
      {!showForm ? (
        <button
          onClick={() => setShowForm(true)}
          className="flex items-center gap-1.5 rounded-md border border-border px-3 py-2 font-sans text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
            <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
          </svg>
          Push to GitHub
        </button>
      ) : (
        <div className="flex flex-col gap-2 rounded-lg border border-border p-3">
          <input
            type="text"
            value={repoInput}
            onChange={(e) => setRepoInput(e.target.value)}
            placeholder="owner/repo"
            className="rounded-md bg-foreground/5 px-2.5 py-1.5 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 outline-none"
          />
          <p className="font-sans text-[10px] text-muted-foreground/50">Creates a new branch (won't push to main)</p>
          <div className="flex gap-2">
            <button
              onClick={handlePush}
              disabled={pushing || !repoInput.includes("/")}
              className="flex-1 rounded-md bg-foreground/10 px-2.5 py-1.5 font-sans text-xs text-foreground hover:bg-foreground/15 transition-colors disabled:opacity-50"
            >
              {pushing ? "Pushing..." : "Push"}
            </button>
            <button
              onClick={() => { setShowForm(false); setResult(null); }}
              className="rounded-md px-2.5 py-1.5 font-sans text-xs text-muted-foreground/60 hover:text-foreground transition-colors"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
      {result && (
        <p className={`font-sans text-xs ${result.ok ? "text-emerald-400" : "text-red-400"}`}>
          {result.message}
        </p>
      )}
    </div>
  );
}

function BlueprintTab({ activeSessionId: rawSessionId }: { activeSessionId: string | null }) {
  // Resolve subtrack → parent workspace so artifacts are scoped to workspace
  const wsTracks = useWorkspaceStore((s) => s.tracks);
  const wsWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const meterSessions = useMeterStore((s) => s.sessions);
  const activeSessionId = useMemo(() => {
    if (!rawSessionId) return null;
    const wsTrack = wsTracks.find((p) => p.id === rawSessionId);
    if (wsTrack?.isSubtrack) {
      const workspace = wsWorkspaces.find((c) => c.id === wsTrack.workspaceId);
      if (workspace?.sessionId) {
        const parent = meterSessions.find((p) => p.id === workspace.sessionId);
        if (parent) return parent.id;
      }
    }
    return rawSessionId;
  }, [rawSessionId, wsTracks, wsWorkspaces, meterSessions]);

  const { artifacts, loading, fetchArtifacts, clearArtifacts } = useArtifactsStore();
  const setPendingInput = useMeterStore((s) => s.setPendingInput);

  // Portal state (handle + workspace slug for docs.meter.chat/{handle}/{slug})
  const [portalSlug, setPortalSlug] = useState<string | null>(null);
  const [portalHandle, setPortalHandle] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [copiedAll, setCopiedAll] = useState(false);

  useEffect(() => {
    if (activeSessionId) {
      fetchArtifacts(activeSessionId);
    } else {
      clearArtifacts();
    }
  }, [activeSessionId, fetchArtifacts, clearArtifacts]);

  // Fetch or create portal slug + handle when we have artifacts
  const fetchPortalSlug = async () => {
    if (!activeSessionId || portalLoading) return;
    setPortalLoading(true);
    try {
      const res = await fetch(`/api/portal?sessionId=${encodeURIComponent(activeSessionId)}`);
      if (res.ok) {
        const data = await res.json();
        setPortalSlug(data.slug);
        setPortalHandle(data.handle);
      }
    } catch { /* silent */ }
    setPortalLoading(false);
  };

  useEffect(() => {
    if (activeSessionId && artifacts.length > 0 && !portalSlug) {
      fetchPortalSlug();
    }
    if (!activeSessionId) {
      setPortalSlug(null);
      setPortalHandle(null);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSessionId, artifacts.length]);

  const openPortal = async () => {
    let slug = portalSlug;
    let handle = portalHandle;
    if (!slug || !handle) {
      // Fetch first, then open
      if (!activeSessionId || portalLoading) return;
      setPortalLoading(true);
      try {
        const res = await authFetch(`/api/portal?sessionId=${encodeURIComponent(activeSessionId)}`);
        if (res.ok) {
          const data = await res.json();
          slug = data.slug;
          handle = data.handle;
          setPortalSlug(slug);
          setPortalHandle(handle);
        }
      } catch { /* silent */ }
      setPortalLoading(false);
    }
    if (slug && handle) {
      window.open(`/docs/${handle}/${slug}`, "_blank");
    }
  };

  const handleGenerate = () => {
    trackArtifactGenerated({ projectId: activeSessionId ?? undefined });
    setPendingInput("Generate strategy artifacts for this project based on all our decisions and conversation so far. Create README.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md, CLAUDE.md, BRAND.md, and .cursorrules files.");
  };

  const handleDownloadZip = () => {
    if (artifacts.length === 0) return;
    // Build a simple text bundle (each file separated)
    const parts = artifacts.map((a) => `--- ${a.filePath} ---\n${a.content}\n`);
    const blob = new Blob([parts.join("\n")], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `documents-${activeSessionId ?? "session"}.txt`;
    link.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Header with actions */}
      <div className="flex items-center justify-between">
        <div className="font-sans text-xs text-muted-foreground/60 uppercase tracking-wider">
          Outputs
        </div>
        <div className="flex items-center gap-1.5">
          {artifacts.length > 0 && (
            <>
              <button
                onClick={async () => {
                  if (artifacts.length === 0) return;
                  const parts = artifacts.map((a) => `--- ${a.filePath} ---\n${a.content}\n`);
                  await navigator.clipboard.writeText(parts.join("\n"));
                  setCopiedAll(true);
                  setTimeout(() => setCopiedAll(false), 1500);
                }}
                className="rounded px-2 py-0.5 font-sans text-xs text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5 transition-colors"
                title="Copy all documents"
              >
                {copiedAll ? "Copied" : "Copy all"}
              </button>
              <button
                onClick={handleDownloadZip}
                className="rounded px-2 py-0.5 font-sans text-xs text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5 transition-colors"
                title="Download all"
              >
                Download all
              </button>
            </>
          )}
        </div>
      </div>

      {/* Push to GitHub */}
      {artifacts.length > 0 && <PushToGitHubButton activeSessionId={activeSessionId} artifacts={artifacts} />}

      {/* Publish / Portal actions */}
      {artifacts.length > 0 && (
        <div className="flex items-center gap-1.5">
          <button
            onClick={() => {
              openPortal();
            }}
            className="flex items-center gap-1.5 rounded px-2 py-1 font-sans text-xs text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5 transition-colors border border-border/50"
          >
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <path d="M4 19.5A2.5 2.5 0 0 1 6.5 17H20" />
              <path d="M4 19.5A2.5 2.5 0 0 0 6.5 22H20V2H6.5A2.5 2.5 0 0 0 4 4.5v15z" />
            </svg>
            {portalLoading ? "Opening..." : "Open docs site"}
          </button>
          {artifacts.length > 0 && (
            <button
              onClick={() => {
                const hasConfig = artifacts.some((a) => a.filePath === "_docs_config.json");
                setPendingInput(hasConfig
                  ? "Update my documentation site. Review the current _docs_config.json and my saved documents, then ask me what I'd like to change — add pages, reorder sections, update content, etc."
                  : "Create a _docs_config.json for my documentation site. Review my saved documents and organize them into a structured navigation. Generate the config as a saved artifact with file_path \"_docs_config.json\" and category \"other\"."
                );
              }}
              className="rounded px-2 py-1 font-sans text-xs text-muted-foreground/60 hover:text-foreground hover:bg-foreground/5 transition-colors"
            >
              Edit
            </button>
          )}
        </div>
      )}

      {/* Document tree */}
      {loading ? (
        <div className="py-4 text-center font-sans text-xs text-muted-foreground/70">
          Loading...
        </div>
      ) : artifacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/70">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="font-sans text-xs text-muted-foreground/70">
            No documents yet
          </span>
          <span className="font-sans text-xs text-muted-foreground/60 text-center">
            Ask Meter to write a doc — specs, proposals, notes, anything
          </span>
        </div>
      ) : (
        <DocumentTree
          artifacts={artifacts}
          onOpen={openPortal}
        />
      )}

    </div>
  );
}



