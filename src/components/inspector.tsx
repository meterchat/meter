"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useMeterStore } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore, Decision } from "@/lib/decisions-store";
import { useArtifactsStore, Artifact } from "@/lib/artifacts-store";
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

const INSPECTOR_TABS = ["decisions", "documents", "timeline", "connect"] as const;

function DeleteDangerZone({
  workspaceName,
  deleteConfirmText,
  onConfirmTextChange,
  onDelete,
  deleting,
  settlingBeforeDelete,
  deleteSettleError,
}: {
  workspaceName: string;
  deleteConfirmText: string;
  onConfirmTextChange: (v: string) => void;
  onDelete: () => void;
  deleting: boolean;
  settlingBeforeDelete: boolean;
  deleteSettleError: string | null;
}) {
  const pendingBalance = useMeterStore.getState().getPendingBalance();
  const hasPending = pendingBalance > 0.01;
  const busy = deleting || settlingBeforeDelete;

  return (
    <div className="flex flex-col gap-3">
      <div className="font-sans text-xs text-red-400/70 uppercase tracking-wider">
        Danger Zone
      </div>
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
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!INSPECTOR_TABS.includes(inspectorTab as typeof INSPECTOR_TABS[number])) {
      setInspectorTab("decisions");
    }
  }, [inspectorTab, setInspectorTab]);

  const handleDeleteWorkspace = async () => {
    if (!activeWorkspace) return;

    // Settle any pending balance before deletion
    const store = useMeterStore.getState();
    const pendingBalance = store.getPendingBalance();
    if (pendingBalance > 0.01) {
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
        {inspectorTab === "decisions" && <DecisionsTab activeSessionId={activeSession?.id ?? null} />}
        {inspectorTab === "documents" && <BlueprintTab activeSessionId={activeSession?.id ?? null} />}
        {inspectorTab === "timeline" && <TimelineTab activeSessionId={activeSession?.id ?? null} />}
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

          {/* Feedback button / badge */}
          {feedbackSent ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-1 font-sans text-xs text-blue-400">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              feedback logged
            </span>
          ) : (
            <button
              onClick={() => setFeedbackOpen(!feedbackOpen)}
              className="inline-flex items-center gap-1.5 rounded-md py-1.5 px-2 font-sans text-xs text-muted-foreground/80 transition-colors hover:text-foreground hover:bg-foreground/5"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
              </svg>
              Feedback
            </button>
          )}

          {/* Feedback dropup */}
          {feedbackOpen && (
            <div
              ref={feedbackRef}
              className="absolute bottom-full right-4 mb-2 w-96 rounded-lg border border-border bg-card shadow-xl z-50"
            >
              <div className="p-3 flex flex-col gap-2">
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Share feedback, ideas, or bugs..."
                  rows={5}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-sans text-xs text-foreground placeholder:text-muted-foreground/70 focus:outline-none focus:border-foreground/20 transition-colors"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && feedbackText.trim()) {
                      e.preventDefault();
                      handleFeedbackSubmit();
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <span className="font-sans text-xs text-muted-foreground/60">
                    {"\u2318"}+Enter to send
                  </span>
                  <button
                    onClick={handleFeedbackSubmit}
                    disabled={!feedbackText.trim() || feedbackSubmitting}
                    className="rounded-md px-3 py-1 font-sans text-xs bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {feedbackSubmitting ? "Sending..." : "Send"}
                  </button>
                </div>
              </div>
            </div>
          )}
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
        className="group flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-foreground/[0.02]"
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
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
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
            className={`group-hover:hidden shrink-0 rounded-full px-1.5 py-0.5 font-sans text-xs tracking-wider ${
              !isDecided
                ? "bg-amber-500/10 text-amber-500"
                : "bg-amber-400/10 text-amber-400"
            }`}
          >
            {statusLabel}
          </span>
        ) : (
          <span className="group-hover:hidden w-0" />
        )}
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
    icon: "M21 12a9 9 0 1 1-18 0 9 9 0 0 1 18 0ZM10 8.5a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0Zm4.5 1.5a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM9.5 14a2.5 2.5 0 0 0 5 0",
    instructions: (apiKey) => [
      {
        label: "Run in your terminal",
        snippet: `claude mcp add meter -e METER_API_KEY=${apiKey} -- npx -y @meter/mcp-server`,
      },
    ],
  },
  {
    id: "cursor",
    name: "Cursor",
    icon: "M5.5 3h13A2.5 2.5 0 0 1 21 5.5v13a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18.5v-13A2.5 2.5 0 0 1 5.5 3ZM8 7v10l8-5-8-5Z",
    instructions: (apiKey) => [
      {
        label: "Add to Settings → MCP Servers",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                command: "npx",
                args: ["-y", "@meter/mcp-server"],
                env: { METER_API_KEY: apiKey },
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
    icon: "M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78Z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                command: "npx",
                args: ["-y", "@meter/mcp-server"],
                env: { METER_API_KEY: apiKey },
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
    icon: "M6 3a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h12V3H6Zm12 9H6a3 3 0 0 0-3 3v3a3 3 0 0 0 3 3h12V12ZM18 3h3v18h-3V3Z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                command: "npx",
                args: ["-y", "@meter/mcp-server"],
                env: { METER_API_KEY: apiKey },
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
    icon: "M12 2L2 19.5h20L12 2Zm0 4l6.93 12H5.07L12 6Z",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                command: "npx",
                args: ["-y", "@meter/mcp-server"],
                env: { METER_API_KEY: apiKey },
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
    icon: "M16.5 9.4l-9-5.19M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z M3.27 6.96L12 12.01l8.73-5.05M12 22.08V12",
    instructions: (apiKey) => [
      {
        label: "Add to your MCP configuration",
        snippet: JSON.stringify(
          {
            mcpServers: {
              meter: {
                command: "npx",
                args: ["-y", "@meter/mcp-server"],
                env: { METER_API_KEY: apiKey },
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

/* ─── Connect Tab ──────────────────────────────────────────────── */

function ConnectTab() {
  const { userId } = useMeterStore();
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
            disabled={loading}
            className="rounded-md border border-border px-3 py-2 font-sans text-xs text-muted-foreground hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
          >
            {loading ? "Generating..." : "Generate API Key"}
          </button>
        )}
        {error && (
          <p className="font-sans text-xs text-red-400 mt-1">{error}</p>
        )}
      </div>

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
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
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
            ["create_decision", "Record decisions from your IDE"],
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

  return (
    <div className="flex flex-col gap-4">
      <PinsSection activeSessionId={activeSessionId} />
      {allVisible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-8 gap-2">
          <span className="font-sans text-xs text-muted-foreground/70">
            No decisions yet
          </span>
          <span className="font-sans text-xs text-muted-foreground/60">
            Decisions are logged as you chat
          </span>
        </div>
      ) : (
        <div className="flex flex-col gap-1">
          {grouped.map(([category, categoryDecisions]) => (
            <CategoryGroup key={category} category={category} decisions={categoryDecisions} />
          ))}
        </div>
      )}
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

  return (
    <div className="rounded-md transition-colors">
      <div
        className="group flex items-center gap-2 py-1.5 px-1 cursor-pointer hover:bg-foreground/[0.02]"
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
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onOpen(); }}
            className="rounded px-1.5 py-0.5 font-sans text-xs text-muted-foreground/70 hover:bg-foreground/10 hover:text-muted-foreground transition-colors flex items-center gap-0.5"
            title="Open in portal"
          >
            open
            <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
              <polyline points="15 3 21 3 21 9" />
              <line x1="10" y1="14" x2="21" y2="3" />
            </svg>
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
        const res = await fetch(`/api/portal?sessionId=${encodeURIComponent(activeSessionId)}`);
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
          Documents
        </div>
        <div className="flex items-center gap-1.5">
          {artifacts.length > 0 && (
            <>
              <button
                onClick={openPortal}
                disabled={portalLoading}
                className="flex items-center gap-1 rounded px-2 py-0.5 font-sans text-xs text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-50"
                title="Open docs portal"
              >
                Open
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
                  <polyline points="15 3 21 3 21 9" />
                  <line x1="10" y1="14" x2="21" y2="3" />
                </svg>
              </button>
              <button
                onClick={handleDownloadZip}
                className="rounded px-2 py-0.5 font-sans text-xs text-muted-foreground/80 hover:text-foreground hover:bg-foreground/5 transition-colors"
                title="Download all"
              >
                Download
              </button>
            </>
          )}
        </div>
      </div>

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

/* ─── TIMELINE TAB ─── */

interface TimelineEvent {
  id: string;
  type: "decision" | "debate" | "dissection" | "document" | "artifact";
  title: string;
  subtitle?: string;
  timestamp: number;
  data: unknown;
}

function formatTimelineDate(ts: number) {
  const d = new Date(ts);
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function formatTimelineTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" });
}

const EVENT_ICONS: Record<TimelineEvent["type"], { color: string; path: string }> = {
  decision: {
    color: "text-emerald-500",
    path: "M9 12l2 2 4-4m6 2a9 9 0 11-18 0 9 9 0 0118 0z",
  },
  debate: {
    color: "text-amber-500",
    path: "M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z",
  },
  dissection: {
    color: "text-violet-500",
    path: "M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z",
  },
  document: {
    color: "text-blue-400",
    path: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
  artifact: {
    color: "text-blue-400",
    path: "M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z",
  },
};

function TimelineTab({ activeSessionId }: { activeSessionId: string | null }) {
  const sessions = useMeterStore((s) => s.sessions);
  const { decisions } = useDecisionsStore();
  const { artifacts } = useArtifactsStore();
  const setScrollToMessageId = useMeterStore((s) => s.setScrollToMessageId);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const session = sessions.find((p) => p.id === activeSessionId);
  const messages = session?.messages ?? [];

  const events = useMemo(() => {
    const items: TimelineEvent[] = [];

    // Decisions
    for (const d of decisions) {
      if (d.archived) continue;
      if (d.sessionId !== activeSessionId) continue;
      items.push({
        id: `decision-${d.id}`,
        type: "decision",
        title: d.title,
        subtitle: d.status === "decided" ? d.choice : "Open",
        timestamp: d.updatedAt || d.createdAt,
        data: d,
      });
    }

    // Debates, dissections, documents — from messages
    for (const m of messages) {
      if (m.debateTrace && m.debateTrace.length > 0) {
        const models = [...new Set(m.debateTrace.map((t) => t.model))];
        items.push({
          id: `debate-${m.id}`,
          type: "debate",
          title: "Debate",
          subtitle: `${models.length} model${models.length !== 1 ? "s" : ""}, ${m.debateTrace.length} turns`,
          timestamp: m.timestamp,
          data: m,
        });
      }

      if (m.dissectorTrace && m.dissectorTrace.length > 0) {
        items.push({
          id: `dissection-${m.id}`,
          type: "dissection",
          title: "Dissection",
          subtitle: `${m.dissectorTrace.length} passes`,
          timestamp: m.timestamp,
          data: m,
        });
      }

      if (m.documents && m.documents.length > 0) {
        for (const doc of m.documents) {
          items.push({
            id: `document-${m.id}-${doc.id}`,
            type: "document",
            title: doc.filePath,
            subtitle: "Generated",
            timestamp: m.timestamp,
            data: { message: m, doc },
          });
        }
      }
    }

    // Artifacts (generated spec kit files)
    for (const a of artifacts) {
      if (a.sessionId !== activeSessionId) continue;
      if (a.lastGeneratedAt) {
        items.push({
          id: `artifact-${a.id}`,
          type: "artifact",
          title: a.filePath,
          subtitle: a.status === "synced" ? "Pushed to GitHub" : "Draft",
          timestamp: a.lastGeneratedAt,
          data: a,
        });
      }
    }

    items.sort((a, b) => b.timestamp - a.timestamp);

    // Deduplicate: if a document and artifact have the same filePath, keep the most recent
    const seen = new Set<string>();
    return items.filter((item) => {
      if (item.type === "document" || item.type === "artifact") {
        const key = `file:${item.title}`;
        if (seen.has(key)) return false;
        seen.add(key);
      }
      return true;
    });
  }, [decisions, messages, artifacts, activeSessionId]);

  // Group by date
  const grouped = useMemo(() => {
    const map = new Map<string, TimelineEvent[]>();
    for (const e of events) {
      const key = formatTimelineDate(e.timestamp);
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(e);
    }
    return Array.from(map.entries());
  }, [events]);

  const handleClick = (event: TimelineEvent) => {
    setExpandedId(expandedId === event.id ? null : event.id);
  };

  const handleJumpToMessage = (messageId: string) => {
    setScrollToMessageId(messageId);
  };

  if (events.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-12 gap-2">
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/60">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-sans text-xs text-muted-foreground/70">No activity yet</span>
        <span className="font-sans text-xs text-muted-foreground/60">
          Decisions, debates, and documents appear here
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([date, dayEvents]) => (
        <div key={date}>
          <div className="font-sans text-xs uppercase tracking-wider text-muted-foreground/70 mb-2 sticky top-0 bg-card py-1 z-10">
            {date}
          </div>
          <div className="relative">
            {/* Vertical line */}
            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-border" />

            <div className="flex flex-col gap-0.5">
              {dayEvents.map((event) => {
                const icon = EVENT_ICONS[event.type];
                const isExpanded = expandedId === event.id;
                return (
                  <div key={event.id}>
                    <button
                      onClick={() => handleClick(event)}
                      className="relative w-full text-left flex items-start gap-2.5 py-1.5 px-1 rounded-md hover:bg-foreground/[0.03] transition-colors group"
                    >
                      {/* Dot */}
                      <div className="relative z-10 mt-0.5">
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className={`${icon.color} shrink-0`}>
                          <path d={icon.path} />
                        </svg>
                      </div>
                      {/* Content */}
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-1.5">
                          <span className="truncate font-sans text-xs text-foreground/80">
                            {event.title}
                          </span>
                        </div>
                        {event.subtitle && (
                          <span className="font-sans text-xs text-muted-foreground/80">
                            {event.subtitle}
                          </span>
                        )}
                      </div>
                      {/* Time */}
                      <span className="shrink-0 font-sans text-xs text-muted-foreground/60 mt-0.5">
                        {formatTimelineTime(event.timestamp)}
                      </span>
                    </button>

                    {/* Expanded detail */}
                    {isExpanded && (
                      <TimelineDetail event={event} onJump={handleJumpToMessage} />
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineDetail({ event, onJump }: { event: TimelineEvent; onJump: (id: string) => void }) {
  if (event.type === "decision") {
    const d = event.data as Decision;
    return (
      <div className="ml-6 mb-2 mt-0.5 border-l border-border/40 pl-3 flex flex-col gap-1.5">
        {d.choice && (
          <div>
            <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground/80">Choice</span>
            <p className="font-sans text-xs text-foreground/90 mt-0.5">{d.choice}</p>
          </div>
        )}
        {Array.isArray(d.alternatives) && d.alternatives.length > 0 && (
          <div>
            <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground/80">Alternatives</span>
            <ul className="mt-0.5">
              {d.alternatives.map((alt, i) => (
                <li key={i} className="font-sans text-xs text-foreground/90 flex items-start gap-1.5">
                  <span className="text-muted-foreground/60 mt-px">-</span>{alt}
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.reasoning && (
          <div>
            <span className="font-sans text-xs uppercase tracking-wider text-muted-foreground/80">Reasoning</span>
            <p className="font-sans text-xs text-foreground/90 mt-0.5">{d.reasoning}</p>
          </div>
        )}
        {d.chatMessageId && (
          <button onClick={() => onJump(d.chatMessageId!)} className="font-sans text-xs text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
            Jump to message
          </button>
        )}
      </div>
    );
  }

  if (event.type === "debate") {
    const m = event.data as { id: string; debateTrace: { model: string; phase: string; content: string }[] };
    const turns = m.debateTrace;
    return (
      <div className="ml-6 mb-2 mt-0.5 border-l border-border/40 pl-3 flex flex-col gap-2">
        {turns.slice(0, 4).map((t, i) => (
          <div key={i}>
            <span className="font-sans text-xs text-muted-foreground/80">{t.model} — {t.phase}</span>
            <p className="font-sans text-xs text-foreground/80 mt-0.5 line-clamp-3">{t.content}</p>
          </div>
        ))}
        {turns.length > 4 && (
          <span className="font-sans text-xs text-muted-foreground/60">+{turns.length - 4} more turns</span>
        )}
        <button onClick={() => onJump(m.id)} className="font-sans text-xs text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
          Jump to message
        </button>
      </div>
    );
  }

  if (event.type === "dissection") {
    const m = event.data as { id: string; dissectorTrace: { persona: string; content: string }[] };
    const passes = m.dissectorTrace;
    return (
      <div className="ml-6 mb-2 mt-0.5 border-l border-border/40 pl-3 flex flex-col gap-2">
        {passes.slice(0, 3).map((p, i) => (
          <div key={i}>
            <span className="font-sans text-xs text-muted-foreground/80">{p.persona}</span>
            <p className="font-sans text-xs text-foreground/80 mt-0.5 line-clamp-3">{p.content}</p>
          </div>
        ))}
        {passes.length > 3 && (
          <span className="font-sans text-xs text-muted-foreground/60">+{passes.length - 3} more passes</span>
        )}
        <button onClick={() => onJump(m.id)} className="font-sans text-xs text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
          Jump to message
        </button>
      </div>
    );
  }

  if (event.type === "document") {
    const { message, doc } = event.data as { message: { id: string }; doc: { filePath: string; content: string } };
    return (
      <div className="ml-6 mb-2 mt-0.5 border-l border-border/40 pl-3 flex flex-col gap-1">
        <p className="font-sans text-xs text-foreground/90 line-clamp-4 whitespace-pre-wrap">{doc.content.slice(0, 300)}{doc.content.length > 300 ? "..." : ""}</p>
        <button onClick={() => onJump(message.id)} className="font-sans text-xs text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
          Jump to message
        </button>
      </div>
    );
  }

  if (event.type === "artifact") {
    const a = event.data as Artifact;
    return (
      <div className="ml-6 mb-2 mt-0.5 border-l border-border/40 pl-3 flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className={`font-sans text-xs rounded-full px-1.5 py-0.5 ${a.status === "synced" ? "text-emerald-500 bg-emerald-500/10" : "text-muted-foreground/80 bg-foreground/5"}`}>
            {a.status}
          </span>
          {a.category && (
            <span className="font-sans text-xs text-muted-foreground/70">{a.category}</span>
          )}
        </div>
        <p className="font-sans text-xs text-foreground/90 line-clamp-3 whitespace-pre-wrap">{a.content.slice(0, 200)}{a.content.length > 200 ? "..." : ""}</p>
      </div>
    );
  }

  return null;
}


