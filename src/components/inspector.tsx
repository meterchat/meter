"use client";

import { useState, useMemo, useEffect } from "react";
import { useTheme } from "next-themes";
import { useMeterStore, selectConnectedServices, ChatMessage, PaymentCard } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { useDecisionsStore, Decision } from "@/lib/decisions-store";
import { CONNECTORS } from "@/lib/connectors";
import { isApiKeyProvider, initiateOAuthFlow } from "@/lib/oauth-client";
import { ApiKeyDialog } from "@/components/api-key-dialog";
import { AddCardModal } from "@/components/add-card-modal";

const INSPECTOR_TABS = ["decisions", "payments", "controls", "connections"] as const;

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
    renameCompany(activeCompany.id, editingName.trim());
    setNameEdited(false);
  };

  if (!inspectorOpen) return null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={() => setInspectorOpen(false)} />
      <div className="fixed right-0 top-0 h-screen w-[420px] border-l border-border bg-card flex flex-col z-50">
        <div className="flex h-12 items-center justify-between border-b border-border px-4">
          <span className="font-mono text-xs text-muted-foreground uppercase tracking-wider">
            Meter
          </span>
          <button
            onClick={() => setInspectorOpen(false)}
            className="text-muted-foreground hover:text-foreground transition-colors"
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
              onClick={() => setInspectorTab(tab)}
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
          {inspectorTab === "payments" && <PaymentsTab activeProject={activeProject} />}
          {inspectorTab === "controls" && <SettingsTab activeProjectId={activeProject?.id ?? null} />}
          {inspectorTab === "connections" && <ConnectionsTab />}
        </div>

        {activeCompany && (
          <div className="border-t border-border px-4 py-3 flex items-center justify-between">
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
          <div className="border-t border-border px-4 py-3 flex items-center justify-end">
            <ThemeToggle />
          </div>
        )}
      </div>

      {/* ── Manage Workspace Dialog ─────────────────────────────────── */}
      {manageOpen && activeCompany && (
        <>
          <div className="fixed inset-0 z-[60] bg-black/50 backdrop-blur-sm" onClick={() => setManageOpen(false)} />
          <div className="fixed z-[70] left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 w-[380px] rounded-xl border border-border bg-card shadow-2xl">
            <div className="flex items-center justify-between border-b border-border px-5 py-4">
              <span className="font-mono text-xs uppercase tracking-wider text-foreground">
                Manage Workspace
              </span>
              <button
                onClick={() => setManageOpen(false)}
                className="text-muted-foreground hover:text-foreground transition-colors"
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
      )}
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

/* ─── SETTINGS TAB ─── */
function SettingsTab({ activeProjectId }: { activeProjectId: string | null }) {
  const spendLimits = useMeterStore((s) => s.spendLimits);
  const fetchSpendLimits = useMeterStore((s) => s.fetchSpendLimits);
  const updateSpendLimits = useMeterStore((s) => s.updateSpendLimits);

  const [dailyInput, setDailyInput] = useState("");
  const [monthlyInput, setMonthlyInput] = useState("");
  const [perTxnInput, setPerTxnInput] = useState("");

  useEffect(() => {
    if (!activeProjectId) return;
    fetchSpendLimits(activeProjectId);
  }, [activeProjectId, fetchSpendLimits]);

  useEffect(() => {
    setDailyInput(spendLimits.dailyLimit != null ? String(spendLimits.dailyLimit) : "");
    setMonthlyInput(spendLimits.monthlyLimit != null ? String(spendLimits.monthlyLimit) : "");
    setPerTxnInput(spendLimits.perTxnLimit != null ? String(spendLimits.perTxnLimit) : "");
  }, [spendLimits]);

  const saveLimitOnBlur = (field: keyof typeof spendLimits, raw: string) => {
    const val = raw.trim() === "" ? null : Number(raw);
    if (val !== null && isNaN(val)) return;
    updateSpendLimits({ [field]: val }, activeProjectId ?? undefined);
  };

  if (!activeProjectId) {
    return (
      <div className="flex flex-col items-center justify-center py-10">
        <span className="font-mono text-xs text-muted-foreground/50">
          Select a workspace to edit controls
        </span>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div>
        <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">
          Spend Controls
        </div>
        <div className="space-y-2">
          <LimitRow
            label="Daily Limit"
            value={dailyInput}
            onChange={setDailyInput}
            onBlur={() => saveLimitOnBlur("dailyLimit", dailyInput)}
          />
          <LimitRow
            label="Monthly Limit"
            value={monthlyInput}
            onChange={setMonthlyInput}
            onBlur={() => saveLimitOnBlur("monthlyLimit", monthlyInput)}
          />
          <LimitRow
            label="Per-Txn Max"
            value={perTxnInput}
            onChange={setPerTxnInput}
            onBlur={() => saveLimitOnBlur("perTxnLimit", perTxnInput)}
          />
        </div>
        <p className="mt-2 font-mono text-[10px] text-muted-foreground/30">
          Leave blank for no limit. Limits are enforced server-side.
        </p>
      </div>
    </div>
  );
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
                      onClick={() => disconnectServiceRemote(connector.id)}
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
    if (isDecided) reopenDecision(decision.id);
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
            onClick={(e) => { e.stopPropagation(); archiveDecision(decision.id); }}
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

/* ─── CARD VISUAL ─── */
const CARD_BACKGROUND = "from-zinc-950 via-zinc-900 to-zinc-800";

function CardVisual({ card, index, isTop, isSwitching, onClick, onRemove, canRemove }: {
  card: PaymentCard;
  index: number;
  isTop: boolean;
  isSwitching: boolean;
  onClick: () => void;
  onRemove?: () => void;
  canRemove: boolean;
}) {
  const brandLabel = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
  return (
    <div
      onClick={onClick}
      className={`relative w-full max-w-[320px] aspect-[1.586/1] mx-auto rounded-2xl p-4 bg-gradient-to-br ${CARD_BACKGROUND} border border-white/10 cursor-pointer transition-all duration-200 ${
        isTop ? "shadow-lg" : "hover:-translate-y-1 shadow-md"
      } ${isSwitching ? "ring-2 ring-emerald-400/60 scale-[1.02]" : ""}`}
      style={{
        marginTop: index > 0 ? "-60px" : undefined,
        zIndex: isTop ? 10 : 10 - index,
      }}
    >
      {card.isDefault && (
        <span className="absolute top-2 right-2 h-2 w-2 rounded-full bg-emerald-400" />
      )}
      <div className="flex items-center justify-between mb-6">
        <svg width="28" height="20" viewBox="0 0 24 16" fill="none" className="text-white/60">
          <rect x="1" y="1" width="22" height="14" rx="2" stroke="currentColor" strokeWidth="1.5" />
          <line x1="1" y1="5" x2="23" y2="5" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        <span className="font-mono text-[11px] text-white/50 uppercase">{brandLabel}</span>
      </div>
      <div className="flex items-end justify-between">
        <span className="font-mono text-[12px] text-white/80 tracking-widest">{card.last4}</span>
        <span className="font-mono text-[11px] text-white/50">
          {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}
        </span>
      </div>
      {isTop && canRemove && onRemove && (
        <button
          onClick={(e) => { e.stopPropagation(); onRemove(); }}
          className="absolute bottom-2 right-2 rounded px-1.5 py-0.5 font-mono text-[10px] text-white/40 hover:text-white/70 hover:bg-white/10 transition-colors"
        >
          remove
        </button>
      )}
    </div>
  );
}

/* ─── PAYMENTS TAB ─── */
function PaymentsTab({ activeProject }: { activeProject: ProjectLike | null }) {
  const cards = useMeterStore((s) => s.cards);
  const cardsLoading = useMeterStore((s) => s.cardsLoading);
  const fetchCards = useMeterStore((s) => s.fetchCards);
  const setDefaultCard = useMeterStore((s) => s.setDefaultCard);
  const removeCard = useMeterStore((s) => s.removeCard);
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

  const [addCardOpen, setAddCardOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [settleSuccess, setSettleSuccess] = useState(false);
  const [switchingCardId, setSwitchingCardId] = useState<string | null>(null);
  const workspaceId = activeProject?.id ?? null;

  useEffect(() => {
    fetchCards();
    if (workspaceId) {
      fetchSettlementHistory(workspaceId);
    }
  }, [fetchCards, fetchSettlementHistory, workspaceId]);

  const sorted = useMemo(() => {
    return [...cards].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0));
  }, [cards]);

  const handleRemove = async (pmId: string) => {
    setRemoveError(null);
    const result = await removeCard(pmId);
    if (!result.success) {
      setRemoveError(result.error ?? "Failed to remove card");
    }
  };

  const canRemoveCards = cards.length > 1;

  const pendingBalance = getPendingBalance();
  const brandLabel = cardBrand ? cardBrand.charAt(0).toUpperCase() + cardBrand.slice(1) : "Card";

  const handleSettle = async () => {
    if (settlementError) clearSettlementError();
    const result = await settleAll();
    if (result.success) {
      setSettleSuccess(true);
      setTimeout(() => setSettleSuccess(false), 2000);
    }
  };

  const handleSetDefault = async (cardId: string) => {
    if (!cardId) return;
    setSwitchingCardId(cardId);
    await setDefaultCard(cardId);
    setTimeout(() => setSwitchingCardId(null), 1200);
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
            Settles automatically at midnight
          </p>
        )}

        {cardLast4 && pendingBalance > 0 && (
          <p className="mt-1.5 text-center font-mono text-[10px] text-muted-foreground/40">
            Charged to {brandLabel} {cardLast4}
          </p>
        )}
      </div>

      <div className="h-px bg-border" />

      {/* Payment Cards — Apple Wallet stack */}
      <div>
        <div className="font-mono text-[11px] text-muted-foreground/60 uppercase tracking-wider mb-2">
          Payment Cards
        </div>
        {cardsLoading && cards.length === 0 ? (
          <div className="py-6 text-center font-mono text-[12px] text-muted-foreground/40">Loading cards...</div>
        ) : sorted.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-8 gap-3 rounded-lg border border-dashed border-border">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/30">
              <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
              <line x1="1" y1="10" x2="23" y2="10" />
            </svg>
            <span className="font-mono text-[12px] text-muted-foreground/40">No cards yet</span>
          </div>
        ) : (
          <div className="relative pb-2 flex flex-col items-center">
            {sorted.map((card, i) => (
              <CardVisual
                key={card.id}
                card={card}
                index={i}
                isTop={i === 0}
                isSwitching={switchingCardId === card.id}
                onClick={() => { if (!card.isDefault) handleSetDefault(card.id); }}
                onRemove={() => handleRemove(card.id)}
                canRemove={canRemoveCards}
              />
            ))}
          </div>
        )}
        {removeError && (
          <p className="mt-1 font-mono text-[11px] text-red-400">{removeError}</p>
        )}
        <button
          onClick={() => setAddCardOpen(true)}
          disabled={addCardOpen}
          className="mt-2 w-full rounded-lg border border-border py-2 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5 disabled:opacity-40"
        >
          + Add Card
        </button>
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
      <AddCardModal open={addCardOpen} onClose={() => setAddCardOpen(false)} />
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
      onClick={() => setTheme(isDark ? "light" : "dark")}
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

function LimitRow({ label, value, onChange, onBlur }: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  onBlur: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className="flex items-center gap-1">
        <span className="font-mono text-xs text-muted-foreground/50">$</span>
        <input
          type="number"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          min={0}
          step={1}
          placeholder="—"
          className="w-16 border-b border-border bg-transparent py-0.5 text-right font-mono text-xs text-foreground placeholder:text-muted-foreground/30 focus:border-foreground focus:outline-none"
        />
      </div>
    </div>
  );
}
