"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMeterStore } from "@/lib/store";
import { useWorkspaceStore } from "@/lib/workspace-store";
import { MeterIcon } from "./meter-icon";
import { AddCardModal } from "./add-card-modal";
import { useIsMobile } from "@/hooks/use-mobile";
import {
  trackCardRemoved,
  trackCardDefaultChanged,
  trackSpendLimitUpdated,
} from "@/lib/analytics";

function useAnimatedNumber(value: number, enabled = true, duration = 350) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (!enabled) {
      // Skip animation — just track the value directly
      setDisplay(value);
      prevRef.current = value;
      return;
    }

    let raf = 0;
    const start = performance.now();
    const from = prevRef.current;
    const diff = value - from;

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const next = from + diff * p;
      setDisplay(next);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = value;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, enabled, duration]);

  return display;
}

function getMsUntilMidnight() {
  const now = new Date();
  const midnight = new Date(now);
  midnight.setHours(24, 0, 0, 0);
  return midnight.getTime() - now.getTime();
}

function formatCountdown(ms: number) {
  const totalSeconds = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h}h ${String(m).padStart(2, "0")}m ${String(s).padStart(2, "0")}s`;
}

function startOfWeek(): number {
  const now = new Date();
  const day = now.getDay();
  const diff = now.getDate() - day + (day === 0 ? -6 : 1);
  const monday = new Date(now);
  monday.setDate(diff);
  monday.setHours(0, 0, 0, 0);
  return monday.getTime();
}

export function HeaderMeter() {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState(getMsUntilMidnight);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const sessions = useMeterStore((s) => s.sessions);
  const activeSessionId = useMeterStore((s) => s.activeSessionId);
  const rawActiveSession = sessions.find((p) => p.id === activeSessionId) ?? sessions[0];

  // When on a subtrack (forked path), resolve to the parent workspace session
  // so the header shows the workspace's stats, not the subtrack's $0 stats.
  const wsTracks = useWorkspaceStore((s) => s.tracks);
  const wsWorkspaces = useWorkspaceStore((s) => s.workspaces);
  const activeProject = useMemo(() => {
    const wsTrack = wsTracks.find((p) => p.id === activeSessionId);
    if (wsTrack?.isSubtrack) {
      // Find the parent workspace's session and use that session for billing
      const workspace = wsWorkspaces.find((c) => c.id === wsTrack.workspaceId);
      if (workspace?.sessionId) {
        const parent = sessions.find((p) => p.id === workspace.sessionId);
        if (parent) return parent;
      }
    }
    return rawActiveSession;
  }, [activeSessionId, rawActiveSession, wsTracks, wsWorkspaces, sessions]);

  const isStreaming = rawActiveSession?.isStreaming ?? false;

  // Payment cards
  const cards = useMeterStore((s) => s.cards);
  const cardsLoading = useMeterStore((s) => s.cardsLoading);
  const fetchCards = useMeterStore((s) => s.fetchCards);
  const setDefaultCard = useMeterStore((s) => s.setDefaultCard);
  const removeCard = useMeterStore((s) => s.removeCard);

  // Settlement — compute pending balance from the resolved workspace project,
  // not the raw activeSessionId (which may be a subtrack with $0).
  const pendingCharges = useMeterStore((s) => s.pendingCharges);
  const getWorkspacePendingBalance = useMemo(() => {
    return () => {
      if (!activeProject) return 0;
      const loadedMsgCost = (activeProject.messages ?? [])
        .filter((m) => m.role === "assistant" && m.cost !== undefined && !m.settled)
        .reduce((sum, m) => sum + (m.cost ?? 0), 0);
      const msgCost = Math.max(activeProject.serverPendingBalance ?? 0, loadedMsgCost);
      const cardCost = pendingCharges
        .filter((c) => c.workspaceId === activeProject.id)
        .reduce((sum, c) => sum + c.cost, 0);
      return msgCost + cardCost;
    };
  }, [activeProject, pendingCharges]);
  const settleAll = useMeterStore((s) => s.settleAll);
  const isSettling = useMeterStore((s) => s.isSettling);
  const cardLast4 = useMeterStore((s) => s.cardLast4);
  const cardBrand = useMeterStore((s) => s.cardBrand);

  // Spend limits
  const spendLimits = useMeterStore((s) => s.spendLimits);
  const fetchSpendLimits = useMeterStore((s) => s.fetchSpendLimits);
  const updateSpendLimits = useMeterStore((s) => s.updateSpendLimits);
  const [dailyInput, setDailyInput] = useState("");
  const [monthlyInput, setMonthlyInput] = useState("");
  const [perTxnInput, setPerTxnInput] = useState("");

  const [addCardOpen, setAddCardOpen] = useState(false);
  const [removeError, setRemoveError] = useState<string | null>(null);
  const [switchingCardId, setSwitchingCardId] = useState<string | null>(null);

  const assistantMsgs = useMemo(
    () => (activeProject?.messages ?? []).filter((m) => m.role === "assistant" && m.cost != null),
    [activeProject]
  );

  const usage = useMemo(() => {
    const today = activeProject?.todayCost ?? 0;
    const week = Math.max(activeProject?.weekCost ?? 0, today);
    const month = Math.max(activeProject?.monthCost ?? 0, today);
    const lifetime = activeProject?.totalCost ?? 0;

    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDayTs = new Date(new Date().setHours(0, 0, 0, 0)).getTime();
    const daysIntoWeek = Math.max(1, Math.floor((startOfDayTs - startOfWeek()) / dayMs) + 1);
    const daysIntoMonth = Math.max(1, new Date().getDate());
    const weekAvg = week / daysIntoWeek;
    const monthAvg = month / daysIntoMonth;

    // Use loaded messages as primary source of truth for counters.
    // Server aggregates (serverTokensIn etc.) are set once on login and go stale
    // as new messages are sent. Loaded messages are always up-to-date.
    // Only fall back to server aggregates when messages are still being fetched
    // (hasOlderMessages = true, meaning we only have the most recent 200).
    const allLoadedMessages = activeProject?.messages ?? [];
    const serverTokensIn = activeProject?.serverTokensIn ?? 0;
    const serverTokensOut = activeProject?.serverTokensOut ?? 0;
    const serverMsgCount = activeProject?.serverMessageCount ?? 0;

    const loadedTokensIn = assistantMsgs.reduce((sum, m) => sum + (m.tokensIn ?? 0), 0);
    const loadedTokensOut = assistantMsgs.reduce((sum, m) => sum + (m.tokensOut ?? 0), 0);

    // Token counts: server aggregates cover the full history but go stale after login.
    // Loaded tokens cover only currently-loaded messages but include new ones.
    // Use the max of both so neither stale server data nor partial loads cause a drop.
    const totalTokensIn = Math.max(serverTokensIn, loadedTokensIn);
    const totalTokensOut = Math.max(serverTokensOut, loadedTokensOut);
    // Message count: use total loaded messages (both roles) or server count, whichever is higher.
    // This handles both "still loading" (server count > loaded) and "new messages" (loaded > server).
    const totalMessages = Math.max(serverMsgCount, allLoadedMessages.length);
    const settledCount = assistantMsgs.filter((m) => m.settled).length;
    const pendingCount = assistantMsgs.filter((m) => !m.settled).length;

    const byModel: Record<string, { cost: number; count: number }> = {};
    for (const m of assistantMsgs) {
      const key = m.model ?? "unknown";
      const existing = byModel[key] || { cost: 0, count: 0 };
      byModel[key] = { cost: existing.cost + (m.cost ?? 0), count: existing.count + 1 };
    }

    return {
      today, week, month, lifetime, weekAvg, monthAvg,
      totalTokensIn, totalTokensOut, totalMessages, settledCount, pendingCount, byModel,
    };
  }, [assistantMsgs, activeProject]);

  const animatedToday = useAnimatedNumber(usage.today, !isStreaming);
  const costStr = isStreaming
    ? `$${animatedToday.toFixed(4)}`
    : `$${animatedToday.toFixed(2)}`;

  useEffect(() => {
    if (!open) return;
    const id = setInterval(() => setRemaining(getMsUntilMidnight()), 1000);
    return () => clearInterval(id);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Fetch cards and spend limits when dropdown opens — use the workspace project ID
  const workspaceProjectId = activeProject?.id ?? activeSessionId;
  useEffect(() => {
    if (!open) return;
    fetchCards();
    if (workspaceProjectId) fetchSpendLimits(workspaceProjectId);
  }, [open, fetchCards, fetchSpendLimits, workspaceProjectId]);

  // Sync limit inputs when store changes
  useEffect(() => {
    setDailyInput(spendLimits.dailyLimit != null ? String(spendLimits.dailyLimit) : "");
    setMonthlyInput(spendLimits.monthlyLimit != null ? String(spendLimits.monthlyLimit) : "");
    setPerTxnInput(spendLimits.perTxnLimit != null ? String(spendLimits.perTxnLimit) : "");
  }, [spendLimits]);

  const sortedCards = useMemo(
    () => [...cards].sort((a, b) => (b.isDefault ? 1 : 0) - (a.isDefault ? 1 : 0)),
    [cards]
  );

  const saveLimitOnBlur = (field: keyof typeof spendLimits, raw: string) => {
    const val = raw.trim() === "" ? null : Number(raw);
    if (val !== null && isNaN(val)) return;
    trackSpendLimitUpdated({ field, value: val, projectId: activeSessionId ?? undefined });
    updateSpendLimits({ [field]: val }, activeSessionId ?? undefined);
  };

  const handleSetDefault = async (cardId: string) => {
    trackCardDefaultChanged({ cardId });
    setSwitchingCardId(cardId);
    await setDefaultCard(cardId);
    setTimeout(() => setSwitchingCardId(null), 1200);
  };

  const handleRemoveCard = async (pmId: string) => {
    setRemoveError(null);
    trackCardRemoved({ cardId: pmId });
    const result = await removeCard(pmId);
    if (!result.success) {
      setRemoveError(result.error ?? "Failed to remove card");
    }
  };

  return (
    <div className="relative" ref={dropdownRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
        title="Today's spend for this workspace"
      >
        {!isMobile && (
          <>
            <div className="flex items-center gap-1.5">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="4" y="2" width="16" height="20" rx="2" ry="2" />
                <path d="M9 22v-4h6v4" />
              </svg>
              <span className="max-w-[110px] truncate text-foreground">
                {activeProject?.name ?? "Workspace"}
              </span>
            </div>
            <span className="h-4 w-px bg-border/70" />
          </>
        )}
        <MeterIcon active={isStreaming} size={14} />
        <span className="tabular-nums text-[12px] font-medium text-foreground">{costStr}</span>
        {!isMobile && (
          <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
            TODAY
          </span>
        )}
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`mobile-sm-ok transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className={`absolute top-full z-50 mt-2 max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl ${isMobile ? "fixed left-2 right-2 w-auto" : "right-0 w-[360px]"}`}>

          {/* Live Counter — prominent cost display at top */}
          <div className="px-4 pt-4 pb-2">
            <div className="flex items-center justify-between">
              <div className="flex flex-col">
                <span className="font-mono text-[24px] font-semibold tabular-nums text-foreground leading-tight">
                  {costStr}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/50 uppercase tracking-wider mt-0.5">
                  Today&apos;s spend
                </span>
              </div>
              <div className="flex flex-col items-end gap-1">
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/70" />
                  <span className="font-mono text-[11px] text-muted-foreground/60">{usage.settledCount} settled</span>
                </div>
                <div className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400/70" />
                  <span className="font-mono text-[11px] text-muted-foreground/60">{usage.pendingCount} pending</span>
                </div>
              </div>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Pending Balance */}
          <PendingBalanceSection
            getPendingBalance={getWorkspacePendingBalance}
            settleAll={settleAll}
            isSettling={isSettling}
          />

          <div className="h-px bg-border" />

          {/* Payment Cards */}
          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Payment Cards
            </div>
            {cardsLoading && cards.length === 0 ? (
              <div className="py-4 text-center font-mono text-[12px] text-muted-foreground/40">Loading cards...</div>
            ) : sortedCards.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 gap-2 rounded-lg border border-dashed border-border">
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="text-muted-foreground/30">
                  <rect x="1" y="4" width="22" height="16" rx="2" ry="2" />
                  <line x1="1" y1="10" x2="23" y2="10" />
                </svg>
                <span className="font-mono text-[11px] text-muted-foreground/40">No cards yet</span>
              </div>
            ) : (
              <div className="flex flex-col gap-1">
                {sortedCards.map((card) => {
                  const brandLabel = card.brand.charAt(0).toUpperCase() + card.brand.slice(1);
                  return (
                    <div
                      key={card.id}
                      className={`flex items-center justify-between rounded-md px-2 py-1.5 font-mono text-[11px] transition-colors ${
                        card.isDefault ? "bg-foreground/5 border border-foreground/10" : "border border-transparent"
                      } ${switchingCardId === card.id ? "ring-1 ring-emerald-400/40" : ""}`}
                    >
                      <div className="flex items-center gap-2">
                        <span className={`h-1.5 w-1.5 rounded-full ${card.isDefault ? "bg-emerald-500" : "bg-muted-foreground/30"}`} />
                        <span className="text-foreground">{brandLabel} •••• {card.last4}</span>
                        <span className="text-[10px] text-muted-foreground/50">
                          {String(card.expMonth).padStart(2, "0")}/{String(card.expYear).slice(-2)}
                        </span>
                      </div>
                      <div className="flex items-center gap-1">
                        {!card.isDefault && (
                          <button
                            onClick={() => handleSetDefault(card.id)}
                            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/50 hover:text-foreground hover:bg-foreground/5 transition-colors"
                          >
                            Default
                          </button>
                        )}
                        {cards.length > 1 && (
                          <button
                            onClick={() => handleRemoveCard(card.id)}
                            className="rounded px-1.5 py-0.5 text-[10px] text-muted-foreground/50 hover:text-red-400 transition-colors"
                          >
                            Remove
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {removeError && (
              <p className="mt-1 font-mono text-[10px] text-red-400">{removeError}</p>
            )}
            <button
              onClick={() => setAddCardOpen(true)}
              className="mt-2 w-full rounded-lg border border-border py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground hover:bg-foreground/5"
            >
              + Add Card
            </button>
          </div>

          <div className="h-px bg-border" />

          {/* Spend */}
          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Spend
            </div>
            <div className="space-y-1.5">
              <SpendRow label="Today" amount={usage.today} />
              <SpendRow label="This week" amount={usage.week} subLabel={`Avg/day $${usage.weekAvg.toFixed(2)}`} />
              <SpendRow label="This month" amount={usage.month} subLabel={`Avg/day $${usage.monthAvg.toFixed(2)}`} />
              <SpendRow label="Lifetime" amount={usage.lifetime} />
            </div>
            <div className="mt-2">
              <p className="font-mono text-[10px] text-muted-foreground/30">
                Daily spend resets at midnight local time.
              </p>
              <p className="font-mono text-[11px] tabular-nums text-muted-foreground/60">
                {formatCountdown(remaining)}
              </p>
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Spend Limits */}
          {activeSessionId && (
            <>
              <div className="px-4 py-3">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                  Spend Limits
                </div>
                <div className="space-y-2">
                  <LimitRow label="Daily Limit" value={dailyInput} onChange={setDailyInput} onBlur={() => saveLimitOnBlur("dailyLimit", dailyInput)} />
                  <LimitRow label="Monthly Limit" value={monthlyInput} onChange={setMonthlyInput} onBlur={() => saveLimitOnBlur("monthlyLimit", monthlyInput)} />
                  <LimitRow label="Per-Txn Max" value={perTxnInput} onChange={setPerTxnInput} onBlur={() => saveLimitOnBlur("perTxnLimit", perTxnInput)} />
                </div>
                <p className="mt-2 font-mono text-[10px] text-muted-foreground/30">
                  Leave blank for no limit. Limits are enforced server-side.
                </p>
              </div>
              <div className="h-px bg-border" />
            </>
          )}

          {/* Activity */}
          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Activity
            </div>
            <StatRow label="Messages" value={usage.totalMessages > 0 ? usage.totalMessages.toLocaleString() : "0"} />
            <StatRow label="Tokens In" value={usage.totalTokensIn > 0 ? usage.totalTokensIn.toLocaleString() : "0"} />
            <StatRow label="Tokens Out" value={usage.totalTokensOut > 0 ? usage.totalTokensOut.toLocaleString() : "0"} />
            <StatRow label="Settled" value={usage.settledCount.toLocaleString()} />
            <StatRow label="Pending" value={usage.pendingCount.toLocaleString()} />
          </div>

          {Object.keys(usage.byModel).length > 0 && (
            <>
              <div className="h-px bg-border" />
              <div className="px-4 py-3">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                  By Model
                </div>
                {Object.entries(usage.byModel).map(([model, data]) => (
                  <div key={model} className="flex items-center justify-between py-1.5">
                    <span className="text-[12px] text-muted-foreground">{model}</span>
                    <span className="text-[12px] text-foreground font-mono">
                      ${data.cost.toFixed(2)} &middot; {data.count} msgs
                    </span>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}
      <AddCardModal open={addCardOpen} onClose={() => setAddCardOpen(false)} />
    </div>
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

function PendingBalanceSection({ getPendingBalance, settleAll, isSettling }: {
  getPendingBalance: () => number;
  settleAll: () => Promise<{ success: boolean }>;
  isSettling: boolean;
}) {
  const [success, setSuccess] = useState(false);
  const pending = getPendingBalance();

  const handleSettle = async () => {
    const result = await settleAll();
    if (result.success) {
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2000);
    }
  };

  return (
    <div className="px-4 py-3">
      <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
        Pending Balance
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[14px] font-medium tabular-nums text-foreground">
            ${pending.toFixed(2)}
          </span>
          <span className="font-mono text-[10px] text-muted-foreground/30">Auto-settles at $10</span>
        </div>
        {pending > 0 && (
          <button
            onClick={handleSettle}
            disabled={isSettling}
            className={`rounded-md px-2 py-1 font-mono text-[10px] transition-colors ${
              success
                ? "text-emerald-500 bg-emerald-500/10"
                : "text-foreground bg-foreground/10 hover:bg-foreground/15 disabled:opacity-40"
            }`}
          >
            {success ? "Settled" : isSettling ? "..." : "Settle"}
          </button>
        )}
      </div>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1.5">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[12px] text-foreground font-mono">{value}</span>
    </div>
  );
}

function SpendRow({ label, amount, subLabel }: { label: string; amount: number; subLabel?: string }) {
  return (
    <div className="flex items-center justify-between">
      <div className="flex flex-col">
        <span className="font-mono text-[12px] text-muted-foreground/70">{label}</span>
        {subLabel && (
          <span className="font-mono text-[10px] text-muted-foreground/40">{subLabel}</span>
        )}
      </div>
      <span className="font-mono text-[12px] tabular-nums text-foreground">
        ${amount.toFixed(2)}
      </span>
    </div>
  );
}
