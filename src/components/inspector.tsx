"use client";

import { useState, useMemo, useEffect, useRef } from "react";
import { useMeterStore, selectConnectedServices } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore, Decision } from "@/lib/decisions-store";
import { initiateOAuthFlow } from "@/lib/oauth-client";
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
  trackArtifactRegenerated,
  trackArtifactPushed,
  trackInspectorToggled,
  trackInspectorTabChanged,
} from "@/lib/analytics";

const INSPECTOR_TABS = ["decisions", "documents", "timeline"] as const;

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
  const feedbackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!INSPECTOR_TABS.includes(inspectorTab as typeof INSPECTOR_TABS[number])) {
      setInspectorTab("decisions");
    }
  }, [inspectorTab, setInspectorTab]);

  const handleDeleteWorkspace = async () => {
    if (!activeWorkspace) return;
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
        <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
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
          className={`flex-1 py-2.5 font-mono text-[11px] uppercase tracking-wider transition-colors ${
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
      </div>

      {activeWorkspace && (
        <div className="relative border-t border-border px-4 py-3 flex items-center justify-between" style={{ paddingBottom: isMobile ? "calc(0.75rem + env(safe-area-inset-bottom, 0px))" : undefined }}>
          <button
            onClick={openManageDialog}
            className="rounded-md py-1.5 px-2 font-mono text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground hover:bg-foreground/5"
          >
            Manage workspace
          </button>

          {/* Feedback button / badge */}
          {feedbackSent ? (
            <span className="inline-flex items-center gap-1 rounded-full bg-blue-500/10 px-2 py-1 font-mono text-[10px] text-blue-400">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="20 6 9 17 4 12" />
              </svg>
              feedback logged
            </span>
          ) : (
            <button
              onClick={() => setFeedbackOpen(!feedbackOpen)}
              className="inline-flex items-center gap-1.5 rounded-md py-1.5 px-2 font-mono text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground hover:bg-foreground/5"
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
              className="absolute bottom-full right-4 mb-2 w-72 rounded-lg border border-border bg-card shadow-xl z-50"
            >
              <div className="p-3 flex flex-col gap-2">
                <textarea
                  value={feedbackText}
                  onChange={(e) => setFeedbackText(e.target.value)}
                  placeholder="Share feedback, ideas, or bugs..."
                  rows={3}
                  className="w-full resize-none rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus:border-foreground/20 transition-colors"
                  autoFocus
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && feedbackText.trim()) {
                      e.preventDefault();
                      handleFeedbackSubmit();
                    }
                  }}
                />
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[10px] text-muted-foreground/30">
                    {"\u2318"}+Enter to send
                  </span>
                  <button
                    onClick={handleFeedbackSubmit}
                    disabled={!feedbackText.trim() || feedbackSubmitting}
                    className="rounded-md px-3 py-1 font-mono text-[11px] bg-foreground text-background transition-colors hover:bg-foreground/90 disabled:opacity-30 disabled:cursor-not-allowed"
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
          <span className="font-mono text-xs uppercase tracking-wider text-foreground">
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
            <label className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider">
              Workspace Name
            </label>
            <div className="flex gap-2">
              <input
                type="text"
                value={editingName}
                onChange={(e) => { setEditingName(e.target.value); setNameEdited(true); }}
                className="flex-1 h-9 rounded-lg border border-border bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
              />
              {nameEdited && editingName.trim() && editingName.trim() !== activeWorkspace.name && (
                <button
                  onClick={handleSaveName}
                  className="h-9 rounded-lg bg-foreground px-3 font-mono text-[11px] text-background transition-colors hover:bg-foreground/90"
                >
                  Save
                </button>
              )}
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Danger Zone */}
          <div className="flex flex-col gap-3">
            <div className="font-mono text-[11px] text-red-400/70 uppercase tracking-wider">
              Danger Zone
            </div>
            <p className="font-mono text-[11px] text-muted-foreground/60 leading-relaxed">
              Type <span className="text-foreground/80">{activeWorkspace.name}</span> to confirm deletion. This removes all messages and data for this workspace.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={activeWorkspace.name}
              className="h-9 rounded-lg border border-red-500/20 bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-red-500/40 transition-colors"
            />
            <button
              onClick={handleDeleteWorkspace}
              disabled={deleting || deleteConfirmText !== activeWorkspace.name}
              className="h-9 rounded-lg bg-red-500/10 border border-red-500/20 font-mono text-[11px] text-red-400 transition-colors hover:bg-red-500/20 disabled:opacity-30 disabled:cursor-not-allowed"
            >
              {deleting ? "Deleting..." : "Delete Workspace"}
            </button>
            <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
              Deleted workspaces are retained for 7 days. To recover, email support@meter.chat within 7 days of deletion.
            </p>
          </div>
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

  if (loading) return <p className="font-mono text-[10px] text-muted-foreground/30">Loading history...</p>;
  if (history.length === 0) return null;

  return (
    <div className="mt-1.5">
      <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">History</span>
      <div className="mt-0.5 flex flex-col gap-0.5">
        {history.map((h) => (
          <div key={h.id} className="font-mono text-[11px] text-foreground/40">
            <span className="text-muted-foreground/50">v{h.version ?? 1}</span>
            <span className="mx-1 text-muted-foreground/20">&middot;</span>
            <span className="text-muted-foreground/30">{new Date(h.updatedAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}</span>
            <span className="mx-1 text-muted-foreground/20">&mdash;</span>
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
          className={`shrink-0 text-muted-foreground/40 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dotColor}`} />
        <span className="flex-1 truncate font-mono text-[12px] text-foreground/80">
          {decision.title}
          {version > 1 && (
            <span className="ml-1 text-muted-foreground/40 text-[10px]">(v{version})</span>
          )}
        </span>
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); handleRevisit(); }}
            className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/40 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            revisit
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); trackDecisionArchived({ decisionId: decision.id }); archiveDecision(decision.id); }}
            className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/40 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            archive
          </button>
        </div>
        {statusLabel ? (
          <span
            className={`group-hover:hidden shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] tracking-wider ${
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
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Choice</span>
              <p className="font-mono text-[12px] text-foreground/70 mt-0.5">{decision.choice}</p>
            </div>
          )}
          {version > 1 && (
            <VersionHistory title={decision.title} projectId={decision.sessionId} />
          )}
          {decision.reasoning && (
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Reasoning</span>
              <p className="font-mono text-[12px] text-foreground/50 mt-0.5">{decision.reasoning}</p>
            </div>
          )}
          {!decision.choice && !decision.reasoning && (
            <p className="font-mono text-[11px] text-muted-foreground/30 italic">No details recorded</p>
          )}
        </div>
      )}
    </div>
  );
}

function CategoryGroup({ category, decisions }: { category: string; decisions: Decision[] }) {
  return (
    <div className="mb-3">
      <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-1 capitalize">
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
      <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">
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
              <p className="font-mono text-[12px] text-foreground/70 leading-relaxed line-clamp-2">
                {preview}{msg.content.length > 100 ? "..." : ""}
              </p>
              {meta && (
                <span className="mt-1 block font-mono text-[10px] text-muted-foreground/40">
                  {meta}
                </span>
              )}
              <button
                onClick={(e) => { e.stopPropagation(); togglePinMessage(msg.id); }}
                className="absolute right-1.5 top-1.5 hidden group-hover:block rounded p-0.5 text-muted-foreground/40 hover:text-amber-500 transition-colors"
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
          <span className="font-mono text-xs text-muted-foreground/40">
            No decisions yet
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/30">
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
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/50">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
    </svg>
  ),
  other: (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/50">
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

function DocumentTree({ artifacts, onRegenerate, onPush, pushing }: {
  artifacts: Artifact[];
  onRegenerate: (filePath: string) => void;
  onPush: (id: string) => void;
  pushing: boolean;
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
                className={`shrink-0 text-muted-foreground/40 transition-transform ${collapsed ? "" : "rotate-90"}`}
              >
                <polyline points="9 18 15 12 9 6" />
              </svg>
              {CATEGORY_ICONS[category] ?? CATEGORY_ICONS.other}
              <span className="font-mono text-[11px] text-muted-foreground/70 uppercase tracking-wider">
                {CATEGORY_LABELS[category] ?? category}
              </span>
              <span className="font-mono text-[10px] text-muted-foreground/30">
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
                    onRegenerate={onRegenerate}
                    onPush={onPush}
                    pushing={pushing}
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

function ArtifactRow({ artifact, onRegenerate, onPush, pushing }: {
  artifact: Artifact;
  onRegenerate: (filePath: string) => void;
  onPush: (id: string) => void;
  pushing: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const isSynced = artifact.status === "synced";
  const isCommitted = !!artifact.lastCommittedContent;
  const isModified = artifact.content && artifact.content !== artifact.lastCommittedContent;

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
          className={`shrink-0 text-muted-foreground/40 transition-transform ${expanded ? "rotate-90" : ""}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0 text-muted-foreground/50">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
          <polyline points="14 2 14 8 20 8" />
        </svg>
        <span className="flex-1 truncate font-mono text-[12px] text-foreground/80">
          {artifact.filePath}
        </span>
        <div className="hidden group-hover:flex items-center gap-1 shrink-0">
          <button
            onClick={(e) => { e.stopPropagation(); onRegenerate(artifact.filePath); }}
            className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/40 hover:bg-foreground/10 hover:text-muted-foreground transition-colors"
          >
            regen
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onPush(artifact.id); }}
            disabled={pushing}
            className="rounded px-1.5 py-0.5 font-mono text-[10px] text-muted-foreground/40 hover:bg-foreground/10 hover:text-muted-foreground transition-colors disabled:opacity-30"
          >
            push
          </button>
        </div>
        <span
          className={`group-hover:hidden shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            isSynced
              ? "bg-emerald-500/10 text-emerald-500"
              : isCommitted
              ? isModified
                ? "bg-amber-500/10 text-amber-500"
                : "bg-foreground/5 text-muted-foreground/50"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          {isSynced ? "synced" : isCommitted ? (isModified ? "modified" : "committed") : "draft"}
        </span>
      </div>

      {expanded && (
        <div className="ml-6 mr-1 mb-2 mt-0.5 flex flex-col gap-1.5 border-l border-border/40 pl-3">
          {artifact.lastGeneratedAt && (
            <span className="font-mono text-[10px] text-muted-foreground/40">
              Generated {formatArtifactTime(artifact.lastGeneratedAt)}
              {artifact.lastPushedAt && ` · Pushed ${formatArtifactTime(artifact.lastPushedAt)}`}
              {artifact.lastCommittedAt && ` · Committed ${formatArtifactTime(artifact.lastCommittedAt)}`}
            </span>
          )}
          {artifact.githubRepo && (
            <span className="font-mono text-[10px] text-muted-foreground/40">
              {artifact.githubRepo}
            </span>
          )}
          {artifact.content && (
            <pre className="max-h-[200px] overflow-y-auto rounded bg-foreground/[0.03] p-2 font-mono text-[11px] text-foreground/60 leading-relaxed whitespace-pre-wrap break-words">
              {artifact.content.slice(0, 2000)}{artifact.content.length > 2000 ? "\n..." : ""}
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

  const { artifacts, loading, pushing, targetRepo, fetchArtifacts, setTargetRepo, setPushing } = useArtifactsStore();
  const setPendingInput = useMeterStore((s) => s.setPendingInput);
  const connectedServices = useMeterStore(selectConnectedServices);
  const githubConnected = !!connectedServices["github"];

  const [repos, setRepos] = useState<{ fullName: string; name: string; private: boolean }[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [showRepoSelector, setShowRepoSelector] = useState(false);

  useEffect(() => {
    if (activeSessionId) {
      fetchArtifacts(activeSessionId);
    }
  }, [activeSessionId, fetchArtifacts]);

  const fetchRepos = async () => {
    if (!githubConnected || !activeSessionId) return;
    setReposLoading(true);
    try {
      const res = await fetch(`/api/github/repos?workspaceId=${encodeURIComponent(activeSessionId)}`);
      if (res.ok) {
        const data = await res.json();
        setRepos((data.repos ?? []).map((r: { fullName: string; name: string; private: boolean }) => ({
          fullName: r.fullName,
          name: r.name,
          private: r.private,
        })));
      }
    } catch { /* silent */ }
    setReposLoading(false);
  };

  const handleGenerate = () => {
    trackArtifactGenerated({ projectId: activeSessionId ?? undefined });
    setPendingInput("Generate strategy artifacts for this project based on all our decisions and conversation so far. Create README.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md, CLAUDE.md, BRAND.md, and .cursorrules files.");
  };

  const handleRegenerate = (filePath: string) => {
    trackArtifactRegenerated({ filePath, projectId: activeSessionId ?? undefined });
    setPendingInput(`Regenerate the ${filePath} strategy artifact based on the latest decisions and conversation context.`);
  };

  const handlePush = async (artifactIds?: string[]) => {
    if (!githubConnected) {
      if (activeSessionId) initiateOAuthFlow("github", activeSessionId);
      return;
    }
    if (!targetRepo) {
      setShowRepoSelector(true);
      await fetchRepos();
      return;
    }
    setPushing(true);
    try {
      const body: Record<string, unknown> = {
        repo: targetRepo,
        workspaceId: activeSessionId,
      };
      if (artifactIds) body.artifactIds = artifactIds;
      const res = await fetch("/api/artifacts/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok && activeSessionId) {
        trackArtifactPushed({ repo: targetRepo, artifactCount: artifactIds?.length, projectId: activeSessionId });
        await fetchArtifacts(activeSessionId);
      }
    } catch { /* silent */ }
    setPushing(false);
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
        <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider">
          Documents
        </div>
        <div className="flex items-center gap-1.5">
          {artifacts.length > 0 && (
            <>
              <button
                onClick={handleDownloadZip}
                className="rounded px-2 py-0.5 font-mono text-[10px] text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
                title="Download all"
              >
                Download
              </button>
              <button
                onClick={() => handlePush()}
                disabled={pushing || artifacts.length === 0}
                className="rounded px-2 py-0.5 font-mono text-[10px] text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors disabled:opacity-30"
              >
                {pushing ? "Pushing..." : "Push to GitHub"}
              </button>
            </>
          )}
        </div>
      </div>

      {/* Repo selector */}
      {showRepoSelector && (
        <div className="rounded-lg border border-border/50 p-2">
          <div className="font-mono text-[10px] text-muted-foreground/50 mb-1.5">
            Select target repo
          </div>
          {reposLoading ? (
            <div className="py-2 text-center font-mono text-[11px] text-muted-foreground/40">
              Loading repos...
            </div>
          ) : (
            <div className="max-h-[160px] overflow-y-auto flex flex-col gap-0.5">
              {repos.map((r) => (
                <button
                  key={r.fullName}
                  onClick={() => {
                    setTargetRepo(r.fullName);
                    setShowRepoSelector(false);
                  }}
                  className={`text-left rounded px-2 py-1.5 font-mono text-[11px] transition-colors hover:bg-foreground/5 ${
                    targetRepo === r.fullName ? "text-foreground bg-foreground/5" : "text-foreground/70"
                  }`}
                >
                  {r.fullName}
                  {r.private && <span className="ml-1.5 text-[9px] text-muted-foreground/40">private</span>}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Target repo indicator */}
      {targetRepo && !showRepoSelector && (
        <div className="flex items-center gap-1.5">
          <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor" className="text-muted-foreground/40 shrink-0">
            <path d="M12 .297c-6.63 0-12 5.373-12 12 0 5.303 3.438 9.8 8.205 11.385.6.113.82-.258.82-.577 0-.285-.01-1.04-.015-2.04-3.338.724-4.042-1.61-4.042-1.61C4.422 18.07 3.633 17.7 3.633 17.7c-1.087-.744.084-.729.084-.729 1.205.084 1.838 1.236 1.838 1.236 1.07 1.835 2.809 1.305 3.495.998.108-.776.417-1.305.76-1.605-2.665-.3-5.466-1.332-5.466-5.93 0-1.31.465-2.38 1.235-3.22-.135-.303-.54-1.523.105-3.176 0 0 1.005-.322 3.3 1.23.96-.267 1.98-.399 3-.405 1.02.006 2.04.138 3 .405 2.28-1.552 3.285-1.23 3.285-1.23.645 1.653.24 2.873.12 3.176.765.84 1.23 1.91 1.23 3.22 0 4.61-2.805 5.625-5.475 5.92.42.36.81 1.096.81 2.22 0 1.606-.015 2.896-.015 3.286 0 .315.21.69.825.57C20.565 22.092 24 17.592 24 12.297c0-6.627-5.373-12-12-12" />
          </svg>
          <span className="font-mono text-[10px] text-muted-foreground/50">{targetRepo}</span>
          <button
            onClick={() => { setShowRepoSelector(true); fetchRepos(); }}
            className="font-mono text-[10px] text-muted-foreground/30 hover:text-muted-foreground transition-colors"
          >
            change
          </button>
        </div>
      )}

      {/* Document tree */}
      {loading ? (
        <div className="py-4 text-center font-mono text-[12px] text-muted-foreground/40">
          Loading...
        </div>
      ) : artifacts.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-6 gap-2">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/20">
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
            <line x1="16" y1="13" x2="8" y2="13" />
            <line x1="16" y1="17" x2="8" y2="17" />
          </svg>
          <span className="font-mono text-[12px] text-muted-foreground/40">
            No documents yet
          </span>
          <span className="font-mono text-[11px] text-muted-foreground/30 text-center">
            Ask Meter to write a doc — specs, proposals, notes, anything
          </span>
        </div>
      ) : (
        <DocumentTree
          artifacts={artifacts}
          onRegenerate={handleRegenerate}
          onPush={(id) => handlePush([id])}
          pushing={pushing}
        />
      )}

      {!githubConnected && artifacts.length > 0 && (
        <div className="mt-2 rounded-lg border border-border/50 bg-foreground/[0.02] px-3 py-2">
          <button
            onClick={() => activeSessionId && initiateOAuthFlow("github", activeSessionId)}
            className="font-mono text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Connect GitHub to push artifacts
          </button>
        </div>
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
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/30">
          <circle cx="12" cy="12" r="10" />
          <polyline points="12 6 12 12 16 14" />
        </svg>
        <span className="font-mono text-xs text-muted-foreground/40">No activity yet</span>
        <span className="font-mono text-[11px] text-muted-foreground/30">
          Decisions, debates, and documents appear here
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {grouped.map(([date, dayEvents]) => (
        <div key={date}>
          <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40 mb-2 sticky top-0 bg-card py-1 z-10">
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
                          <span className="truncate font-mono text-[12px] text-foreground/80">
                            {event.title}
                          </span>
                        </div>
                        {event.subtitle && (
                          <span className="font-mono text-[10px] text-muted-foreground/50">
                            {event.subtitle}
                          </span>
                        )}
                      </div>
                      {/* Time */}
                      <span className="shrink-0 font-mono text-[10px] text-muted-foreground/30 mt-0.5">
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
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Choice</span>
            <p className="font-mono text-[12px] text-foreground/70 mt-0.5">{d.choice}</p>
          </div>
        )}
        {Array.isArray(d.alternatives) && d.alternatives.length > 0 && (
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Alternatives</span>
            <ul className="mt-0.5">
              {d.alternatives.map((alt, i) => (
                <li key={i} className="font-mono text-[12px] text-foreground/50 flex items-start gap-1.5">
                  <span className="text-muted-foreground/30 mt-px">-</span>{alt}
                </li>
              ))}
            </ul>
          </div>
        )}
        {d.reasoning && (
          <div>
            <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Reasoning</span>
            <p className="font-mono text-[12px] text-foreground/50 mt-0.5">{d.reasoning}</p>
          </div>
        )}
        {d.chatMessageId && (
          <button onClick={() => onJump(d.chatMessageId!)} className="font-mono text-[10px] text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
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
            <span className="font-mono text-[10px] text-muted-foreground/50">{t.model} — {t.phase}</span>
            <p className="font-mono text-[11px] text-foreground/60 mt-0.5 line-clamp-3">{t.content}</p>
          </div>
        ))}
        {turns.length > 4 && (
          <span className="font-mono text-[10px] text-muted-foreground/30">+{turns.length - 4} more turns</span>
        )}
        <button onClick={() => onJump(m.id)} className="font-mono text-[10px] text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
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
            <span className="font-mono text-[10px] text-muted-foreground/50">{p.persona}</span>
            <p className="font-mono text-[11px] text-foreground/60 mt-0.5 line-clamp-3">{p.content}</p>
          </div>
        ))}
        {passes.length > 3 && (
          <span className="font-mono text-[10px] text-muted-foreground/30">+{passes.length - 3} more passes</span>
        )}
        <button onClick={() => onJump(m.id)} className="font-mono text-[10px] text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
          Jump to message
        </button>
      </div>
    );
  }

  if (event.type === "document") {
    const { message, doc } = event.data as { message: { id: string }; doc: { filePath: string; content: string } };
    return (
      <div className="ml-6 mb-2 mt-0.5 border-l border-border/40 pl-3 flex flex-col gap-1">
        <p className="font-mono text-[11px] text-foreground/50 line-clamp-4 whitespace-pre-wrap">{doc.content.slice(0, 300)}{doc.content.length > 300 ? "..." : ""}</p>
        <button onClick={() => onJump(message.id)} className="font-mono text-[10px] text-blue-400 hover:text-blue-300 text-left mt-1 transition-colors">
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
          <span className={`font-mono text-[10px] rounded-full px-1.5 py-0.5 ${a.status === "synced" ? "text-emerald-500 bg-emerald-500/10" : "text-muted-foreground/50 bg-foreground/5"}`}>
            {a.status}
          </span>
          {a.category && (
            <span className="font-mono text-[10px] text-muted-foreground/40">{a.category}</span>
          )}
        </div>
        <p className="font-mono text-[11px] text-foreground/50 line-clamp-3 whitespace-pre-wrap">{a.content.slice(0, 200)}{a.content.length > 200 ? "..." : ""}</p>
      </div>
    );
  }

  return null;
}


