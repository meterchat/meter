"use client";

import { useState, useMemo, useEffect } from "react";
import { useTheme } from "next-themes";
import { useMeterStore, selectConnectedServices, ChatMessage } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore, Decision } from "@/lib/decisions-store";
import { CONNECTORS } from "@/lib/connectors";
import { isApiKeyProvider, initiateOAuthFlow } from "@/lib/oauth-client";
import { useArtifactsStore, Artifact } from "@/lib/artifacts-store";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { Drawer, DrawerContent } from "@/components/ui/drawer";
import {
  trackWorkspaceDeleted,
  trackWorkspaceRenamed,
  trackDecisionArchived,
  trackDecisionReopened,
  trackDecisionRevisited,
  trackConnectorInitiated,
  trackConnectorDisconnected,
  trackArtifactGenerated,
  trackArtifactRegenerated,
  trackArtifactPushed,
  trackSettlementInitiated,
  trackSettlementCompleted,
  trackSettlementFailed,
  trackInspectorToggled,
  trackInspectorTabChanged,
  trackThemeChanged,
} from "@/lib/analytics";

const INSPECTOR_TABS = ["decisions", "documents", "payments", "connections"] as const;

export function Inspector() {
  const {
    inspectorOpen,
    setInspectorOpen,
    inspectorTab,
    setInspectorTab,
    projects,
    activeProjectId,
    userId,
    removeProject,
  } = useMeterStore();

  const activeCompanyId = useWorkspaceStore((s) => s.activeCompanyId);
  const companies = useWorkspaceStore((s) => s.companies);
  const deleteCompany = useWorkspaceStore((s) => s.deleteCompany);
  const renameCompany = useWorkspaceStore((s) => s.renameCompany);
  const setActiveCompany = useWorkspaceStore((s) => s.setActiveCompany);

  const activeCompany = companies.find((c) => c.id === activeCompanyId) ?? null;
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? null;

  const [manageOpen, setManageOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [editingName, setEditingName] = useState("");
  const [nameEdited, setNameEdited] = useState(false);

  useEffect(() => {
    if (!INSPECTOR_TABS.includes(inspectorTab as typeof INSPECTOR_TABS[number])) {
      setInspectorTab("decisions");
    }
  }, [inspectorTab, setInspectorTab]);

  const handleDeleteWorkspace = async () => {
    if (!activeCompany) return;
    trackWorkspaceDeleted({ workspaceId: activeCompany.id, workspaceName: activeCompany.name });
    setDeleting(true);

    // Soft-delete server-side session (sets deleted_at, retained 7 days)
    const sessionId = activeCompany.sessionId;
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
    if (sessionId) removeProject(sessionId);
    const companyId = activeCompany.id;
    deleteCompany(companyId);

    // Switch to next available workspace
    const remaining = companies.filter((c) => c.id !== companyId);
    if (remaining.length > 0) {
      setActiveCompany(remaining[0].id);
      const nextSession = remaining[0].sessionId;
      if (nextSession) {
        const { setActiveProject } = useMeterStore.getState();
        setActiveProject(nextSession);
      }
    }

    setManageOpen(false);
    setDeleteConfirmText("");
    setDeleting(false);
    setInspectorOpen(false);
  };

  const openManageDialog = () => {
    if (activeCompany) {
      setEditingName(activeCompany.name);
      setNameEdited(false);
      setDeleteConfirmText("");
    }
    setManageOpen(true);
  };

  const handleSaveName = () => {
    if (!activeCompany || !editingName.trim()) return;
    trackWorkspaceRenamed({ workspaceId: activeCompany.id, oldName: activeCompany.name, newName: editingName.trim() });
    renameCompany(activeCompany.id, editingName.trim());
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
        {inspectorTab === "decisions" && <DecisionsTab activeProjectId={activeProject?.id ?? null} />}
        {inspectorTab === "documents" && <BlueprintTab activeProjectId={activeProject?.id ?? null} />}
        {inspectorTab === "payments" && <PaymentsTab activeProject={activeProject} />}
        {inspectorTab === "connections" && <ConnectionsTab />}
      </div>

      {activeCompany && (
        <div className="border-t border-border px-4 py-3 flex items-center justify-between" style={{ paddingBottom: isMobile ? "calc(0.75rem + env(safe-area-inset-bottom, 0px))" : undefined }}>
          <button
            onClick={openManageDialog}
            className="rounded-md py-1.5 px-2 font-mono text-[11px] text-muted-foreground/50 transition-colors hover:text-foreground hover:bg-foreground/5"
          >
            Manage workspace
          </button>
          <ThemeToggle />
        </div>
      )}
      {!activeCompany && (
        <div className="border-t border-border px-4 py-3 flex items-center justify-end" style={{ paddingBottom: isMobile ? "calc(0.75rem + env(safe-area-inset-bottom, 0px))" : undefined }}>
          <ThemeToggle />
        </div>
      )}
    </>
  );

  const manageDialog = manageOpen && activeCompany ? (
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
              {nameEdited && editingName.trim() && editingName.trim() !== activeCompany.name && (
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
              Type <span className="text-foreground/80">{activeCompany.name}</span> to confirm deletion. This removes all messages and data for this workspace.
            </p>
            <input
              type="text"
              value={deleteConfirmText}
              onChange={(e) => setDeleteConfirmText(e.target.value)}
              placeholder={activeCompany.name}
              className="h-9 rounded-lg border border-red-500/20 bg-background px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-red-500/40 transition-colors"
            />
            <button
              onClick={handleDeleteWorkspace}
              disabled={deleting || deleteConfirmText !== activeCompany.name}
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

/* ─── SHARED TYPES ─── */
interface ProjectLike {
  id: string;
  messages: ChatMessage[];
  todayCost: number;
  todayTokensIn: number;
  todayTokensOut: number;
  todayMessageCount: number;
  todayByModel: Record<string, { cost: number; count: number }>;
  totalCost: number;
  settlementError?: string | null;
  chatBlocked?: boolean;
}

/* ─── CONNECTIONS TAB ─── */
function ConnectionsTab() {
  const connectedServices = useMeterStore(selectConnectedServices);
  const userId = useMeterStore((s) => s.userId);
  const activeProjectId = useMeterStore((s) => s.activeProjectId);
  const disconnectServiceRemote = useMeterStore((s) => s.disconnectServiceRemote);
  const connectionsLoading = useMeterStore((s) => s.connectionsLoading);
  const [apiKeyProvider, setApiKeyProvider] = useState<string | null>(null);

  const handleConnect = (providerId: string) => {
    if (!userId) return;
    trackConnectorInitiated({ provider: providerId, method: isApiKeyProvider(providerId) ? "api_key" : "oauth" });
    if (isApiKeyProvider(providerId)) {
      setApiKeyProvider(providerId);
    } else {
      initiateOAuthFlow(providerId, activeProjectId);
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {connectionsLoading && (
        <div className="rounded-lg border border-border/50 bg-foreground/[0.03] px-3 py-2 font-mono text-[11px] text-muted-foreground/60">
          Syncing connections...
        </div>
      )}
      <div className="space-y-1.5">
        {CONNECTORS.map((connector) => {
          const connected = !!connectedServices[connector.id];
          return (
            <div
              key={connector.id}
              className="flex items-center gap-2.5 rounded-lg border border-border/50 px-3 py-2 hover:bg-foreground/[0.03] transition-colors"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="currentColor"
                className="text-muted-foreground shrink-0"
              >
                <path d={connector.iconPath} />
              </svg>
              <div className="min-w-0">
                <div className="text-[12px] text-foreground">{connector.name}</div>
                <div className="font-mono text-[10px] text-muted-foreground/50">
                  {connector.description}
                </div>
              </div>
              <div className="ml-auto shrink-0">
                {connected ? (
                  <div className="flex items-center gap-1.5">
                    <span className="font-mono text-[10px] text-emerald-500">
                      Connected
                    </span>
                    <button
                      onClick={() => { trackConnectorDisconnected({ provider: connector.id }); disconnectServiceRemote(connector.id); }}
                      className="text-muted-foreground/40 hover:text-red-400 transition-colors"
                      title="Disconnect"
                    >
                      <svg
                        width="12"
                        height="12"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                      >
                        <line x1="18" y1="6" x2="6" y2="18" />
                        <line x1="6" y1="6" x2="18" y2="18" />
                      </svg>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => handleConnect(connector.id)}
                    className="rounded-md border border-border px-2.5 py-1 font-mono text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/20 transition-colors"
                  >
                    Connect
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {apiKeyProvider && (
        <ApiKeyDialog
          provider={apiKeyProvider}
          onClose={() => setApiKeyProvider(null)}
        />
      )}
    </div>
  );
}

/* ─── DECISIONS TAB ─── */
function DecisionRow({ decision }: { decision: Decision }) {
  const { archiveDecision, reopenDecision } = useDecisionsStore();
  const setPendingInput = useMeterStore((s) => s.setPendingInput);
  const [expanded, setExpanded] = useState(false);
  const isDecided = decision.status === "decided";

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
        <span
          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
            isDecided ? "bg-emerald-500" : "bg-amber-500"
          }`}
        />
        <span className="flex-1 truncate font-mono text-[12px] text-foreground/80">
          {decision.title}
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
        <span
          className={`group-hover:hidden shrink-0 rounded-full px-1.5 py-0.5 font-mono text-[10px] uppercase tracking-wider ${
            isDecided
              ? "bg-emerald-500/10 text-emerald-500"
              : "bg-amber-500/10 text-amber-500"
          }`}
        >
          {isDecided ? "decided" : "open"}
        </span>
      </div>

      {expanded && (
        <div className="ml-6 mr-1 mb-2 mt-0.5 flex flex-col gap-1.5 border-l border-border/40 pl-3">
          {decision.choice && (
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Choice</span>
              <p className="font-mono text-[12px] text-foreground/70 mt-0.5">{decision.choice}</p>
            </div>
          )}
          {Array.isArray(decision.alternatives) && decision.alternatives.length > 0 && (
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Alternatives</span>
              <ul className="mt-0.5">
                {decision.alternatives.map((alt, i) => (
                  <li key={i} className="font-mono text-[12px] text-foreground/50 flex items-start gap-1.5">
                    <span className="text-muted-foreground/30 mt-px">-</span>
                    {alt}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {decision.reasoning && (
            <div>
              <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">Reasoning</span>
              <p className="font-mono text-[12px] text-foreground/50 mt-0.5">{decision.reasoning}</p>
            </div>
          )}
          {!decision.choice && !decision.reasoning && (!Array.isArray(decision.alternatives) || decision.alternatives.length === 0) && (
            <p className="font-mono text-[11px] text-muted-foreground/30 italic">No details recorded</p>
          )}
        </div>
      )}
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

function PinsSection({ activeProjectId }: { activeProjectId: string | null }) {
  const projects = useMeterStore((s) => s.projects);
  const togglePinMessage = useMeterStore((s) => s.togglePinMessage);
  const setScrollToMessageId = useMeterStore((s) => s.setScrollToMessageId);
  const project = projects.find((p) => p.id === activeProjectId);
  const pinned = project?.messages.filter((m) => m.pinned) ?? [];

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

function DecisionsTab({ activeProjectId }: { activeProjectId: string | null }) {
  const { decisions } = useDecisionsStore();
  const scoped = decisions
    .filter((d) => !d.archived && d.projectId && d.projectId === activeProjectId)
    .sort((a, b) => {
      if (a.status !== b.status) return a.status === "undecided" ? -1 : 1;
      return b.updatedAt - a.updatedAt;
    });
  const legacy = decisions
    .filter((d) => !d.archived && !d.projectId)
    .sort((a, b) => b.updatedAt - a.updatedAt);

  return (
    <div className="flex flex-col gap-4">
      <PinsSection activeProjectId={activeProjectId} />
      <div>
        <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">
          Decisions
        </div>
        {scoped.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-2">
            <span className="font-mono text-xs text-muted-foreground/40">
              No decisions yet
            </span>
            <span className="font-mono text-[11px] text-muted-foreground/30">
              Decisions are logged as you chat
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-0.5">
            {scoped.map((d) => (
              <DecisionRow key={d.id} decision={d} />
            ))}
          </div>
        )}
      </div>
      {legacy.length > 0 && (
        <>
          <div className="h-px bg-border" />
          <div>
            <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">
              Unassigned
            </div>
            <div className="flex flex-col gap-0.5">
              {legacy.map((d) => (
                <DecisionRow key={d.id} decision={d} />
              ))}
            </div>
          </div>
        </>
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

function BlueprintTab({ activeProjectId }: { activeProjectId: string | null }) {
  const { artifacts, loading, pushing, targetRepo, fetchArtifacts, setTargetRepo, setPushing } = useArtifactsStore();
  const setPendingInput = useMeterStore((s) => s.setPendingInput);
  const connectedServices = useMeterStore(selectConnectedServices);
  const activeProjectIdFromStore = useMeterStore((s) => s.activeProjectId);
  const githubConnected = !!connectedServices["github"];

  const [repos, setRepos] = useState<{ fullName: string; name: string; private: boolean }[]>([]);
  const [reposLoading, setReposLoading] = useState(false);
  const [showRepoSelector, setShowRepoSelector] = useState(false);

  useEffect(() => {
    if (activeProjectId) {
      fetchArtifacts(activeProjectId);
    }
  }, [activeProjectId, fetchArtifacts]);

  const fetchRepos = async () => {
    if (!githubConnected || !activeProjectIdFromStore) return;
    setReposLoading(true);
    try {
      const res = await fetch(`/api/github/repos?workspaceId=${encodeURIComponent(activeProjectIdFromStore)}`);
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
    trackArtifactGenerated({ projectId: activeProjectId ?? undefined });
    setPendingInput("Generate strategy artifacts for this project based on all our decisions and conversation so far. Create README.md, ARCHITECTURE.md, DESIGN.md, DECISIONS.md, CLAUDE.md, BRAND.md, and .cursorrules files.");
  };

  const handleRegenerate = (filePath: string) => {
    trackArtifactRegenerated({ filePath, projectId: activeProjectId ?? undefined });
    setPendingInput(`Regenerate the ${filePath} strategy artifact based on the latest decisions and conversation context.`);
  };

  const handlePush = async (artifactIds?: string[]) => {
    if (!githubConnected) {
      initiateOAuthFlow("github", activeProjectIdFromStore);
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
        workspaceId: activeProjectIdFromStore,
      };
      if (artifactIds) body.artifactIds = artifactIds;
      const res = await fetch("/api/artifacts/push", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.ok && activeProjectId) {
        trackArtifactPushed({ repo: targetRepo, artifactCount: artifactIds?.length, projectId: activeProjectId });
        await fetchArtifacts(activeProjectId);
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
    link.download = `documents-${activeProjectId ?? "project"}.txt`;
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
          <button
            onClick={handleGenerate}
            className="rounded px-2 py-0.5 font-mono text-[10px] text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
          >
            Generate
          </button>
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
          <span className="font-mono text-[11px] text-muted-foreground/30">
            Ask Meter to write any doc, or generate strategy specs
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
            onClick={() => initiateOAuthFlow("github", activeProjectIdFromStore)}
            className="font-mono text-[11px] text-muted-foreground/60 hover:text-foreground transition-colors"
          >
            Connect GitHub to push artifacts
          </button>
        </div>
      )}
    </div>
  );
}

/* ─── PAYMENTS TAB ─── */
function PaymentsTab({ activeProject }: { activeProject: ProjectLike | null }) {
  const settlementHistory = useMeterStore((s) => s.settlementHistory);
  const settlementHistoryLoading = useMeterStore((s) => s.settlementHistoryLoading);
  const fetchSettlementHistory = useMeterStore((s) => s.fetchSettlementHistory);
  const getPendingBalance = useMeterStore((s) => s.getPendingBalance);
  const settleAll = useMeterStore((s) => s.settleAll);
  const isSettling = useMeterStore((s) => s.isSettling);
  const clearSettlementError = useMeterStore((s) => s.clearSettlementError);
  const cardLast4 = useMeterStore((s) => s.cardLast4);
  const cardBrand = useMeterStore((s) => s.cardBrand);

  const settlementError = activeProject?.settlementError ?? null;

  const [settleSuccess, setSettleSuccess] = useState(false);
  const workspaceId = activeProject?.id ?? null;

  useEffect(() => {
    if (workspaceId) {
      fetchSettlementHistory(workspaceId);
    }
  }, [fetchSettlementHistory, workspaceId]);

  const pendingBalance = getPendingBalance();
  const brandLabel = cardBrand ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1) : "Card";

  const handleSettle = async () => {
    if (settlementError) clearSettlementError();
    trackSettlementInitiated({ amount: pendingBalance, projectId: workspaceId ?? undefined });
    const result = await settleAll();
    if (result.success) {
      trackSettlementCompleted({ amount: pendingBalance, projectId: workspaceId ?? undefined });
      setSettleSuccess(true);
      setTimeout(() => setSettleSuccess(false), 2000);
    } else {
      trackSettlementFailed({ amount: pendingBalance, projectId: workspaceId ?? undefined });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Settle */}
      <div className="rounded-lg border border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <span className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider">Outstanding</span>
          <span className="font-mono text-[13px] font-medium tabular-nums text-foreground">
            ${pendingBalance.toFixed(2)}
          </span>
        </div>

        {settlementError ? (
          <>
            <div className="mb-2 rounded-lg border border-red-500/20 bg-red-500/10 px-3 py-2">
              <span className="font-mono text-[11px] text-red-400">{settlementError}</span>
              <p className="mt-0.5 font-mono text-[10px] text-red-400/60">Please update your card or try again.</p>
            </div>

            <button
              onClick={handleSettle}
              disabled={isSettling || pendingBalance <= 0}
              className={`w-full rounded-lg py-2.5 font-mono text-[12px] transition-colors ${
                settleSuccess
                  ? "bg-emerald-500/20 text-emerald-400 border border-emerald-500/30"
                  : "bg-foreground text-background hover:bg-foreground/90 disabled:opacity-40"
              }`}
            >
              {settleSuccess ? "Settled" : isSettling ? "Processing..." : `Pay & Settle $${pendingBalance.toFixed(2)}`}
            </button>
          </>
        ) : (
          <p className="font-mono text-[10px] text-muted-foreground/50 text-center py-1">
            Settles automatically at $10
          </p>
        )}

        {cardLast4 && pendingBalance > 0 && (
          <p className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground/40">
            Charged to {brandLabel} {cardLast4}
          </p>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Settlement History */}
      <div>
        <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">
          Settlement History
        </div>
        {settlementHistoryLoading && settlementHistory.length === 0 ? (
          <div className="py-4 text-center font-mono text-[12px] text-muted-foreground/40">Loading...</div>
        ) : settlementHistory.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-6 gap-2">
            <span className="font-mono text-[12px] text-muted-foreground/40">No settlements yet</span>
            <span className="font-mono text-[11px] text-muted-foreground/30">
              Settlements appear here as they happen
            </span>
          </div>
        ) : (
          <div className="flex flex-col gap-1">
            {settlementHistory.map((s) => {
              const brandLabel = s.cardBrand
                ? s.cardBrand.charAt(0).toUpperCase() + s.cardBrand.slice(1)
                : "";
              return (
                <div key={s.id} className="flex items-center justify-between py-1.5 font-mono text-[12px]">
                  <div className="flex flex-col gap-0.5 min-w-0">
                    <span className="text-foreground/80">
                      ${s.amount.toFixed(2)}
                      <span className="text-muted-foreground/40 ml-1.5">
                        {new Date(s.createdAt).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      </span>
                    </span>
                    <span className="text-[10px] text-muted-foreground/40">
                      {brandLabel} {s.cardLast4 ?? ""} &middot; {s.messageCount} msgs
                    </span>
                  </div>
                  <span className={`shrink-0 text-[10px] ${s.status === "succeeded" ? "text-emerald-500/60" : "text-red-400/60"}`}>
                    {s.status}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

/* ─── THEME TOGGLE ─── */
function ThemeToggle() {
  const { resolvedTheme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!mounted) return <div className="w-[52px] h-[26px]" />;

  const isDark = resolvedTheme === "dark";

  return (
    <button
      onClick={() => { const next = isDark ? "light" : "dark"; trackThemeChanged({ theme: next }); setTheme(next); }}
      className="relative h-[26px] w-[52px] rounded-full border border-border bg-background transition-colors hover:border-foreground/20"
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
    >
      <div
        className={`absolute top-[2px] h-[20px] w-[20px] rounded-full transition-all duration-200 flex items-center justify-center ${
          isDark
            ? "left-[2px] bg-foreground/15"
            : "left-[28px] bg-foreground/15"
        }`}
      >
        {isDark ? (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
          </svg>
        ) : (
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground">
            <circle cx="12" cy="12" r="5" />
            <line x1="12" y1="1" x2="12" y2="3" />
            <line x1="12" y1="21" x2="12" y2="23" />
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64" />
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78" />
            <line x1="1" y1="12" x2="3" y2="12" />
            <line x1="21" y1="12" x2="23" y2="12" />
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36" />
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22" />
          </svg>
        )}
      </div>
    </button>
  );
}

