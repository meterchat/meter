"use client";

import { useState, useEffect, useRef } from "react";
import { useSyncStore } from "@/lib/sync-store";
import { runSync, formatSyncReport } from "@/lib/sync-engine";
import { runReconcile } from "@/lib/reconcile-engine";
import { useMeterStore } from "@/lib/store";

function timeAgo(ts: number): string {
  const diff = Date.now() - ts;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

function findingCounts(findings: { type: string; dismissed?: boolean; fixed?: boolean }[]) {
  const active = findings.filter((f) => !f.dismissed && !f.fixed);
  return {
    contradictions: active.filter((f) => f.type === "contradiction").length,
    gaps: active.filter((f) => f.type === "gap").length,
    stale: active.filter((f) => f.type === "stale").length,
    conflicts: active.filter((f) => f.type === "conflict").length,
    total: active.length,
  };
}

/** Infinity path data (shared between base and tracer) */
const INFINITY_PATH = "M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z";

/** Infinity icon SVG — the sync symbol.
 *  When `active`, the symbol fills with gold from start to end,
 *  then cycles through dark grey before filling again. */
function InfinityIcon({ className, size = 16, active = false }: { className?: string; size?: number; active?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* Base path — always visible, dark grey */}
      <path d={INFINITY_PATH} stroke="currentColor" />
      {/* Fill path — gold stroke that progressively draws the full symbol */}
      {active && (
        <path
          d={INFINITY_PATH}
          stroke="url(#sync-fill-gradient)"
          strokeWidth="2.5"
          className="sync-fill"
        />
      )}
      {active && (
        <defs>
          <linearGradient id="sync-fill-gradient" x1="0" y1="0" x2="1" y2="0">
            <stop offset="0%" stopColor="#d97706" />
            <stop offset="50%" stopColor="#f59e0b" />
            <stop offset="100%" stopColor="#fbbf24" />
          </linearGradient>
        </defs>
      )}
    </svg>
  );
}

export function SyncButton() {
  const [open, setOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const lastReport = useSyncStore((s) => s.lastReport);
  const isSyncing = useSyncStore((s) => s.isSyncing);
  const isReconciling = useSyncStore((s) => s.isReconciling);
  const reconciledCount = useSyncStore((s) => s.reconciledCount);
  const reconcileTotal = useSyncStore((s) => s.reconcileTotal);
  const reconcileCost = useSyncStore((s) => s.reconcileCost);
  const reconcileError = useSyncStore((s) => s.reconcileError);

  const clearReport = useSyncStore((s) => s.clearReport);
  const cancelOperation = useSyncStore((s) => s.cancelOperation);
  const addMessage = useMeterStore((s) => s.addMessage);

  // Close on outside click
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

  const handleStartSync = () => {
    runSync();
  };

  const handleViewReport = () => {
    const report = formatSyncReport();
    addMessage({
      id: `sync-report-${Date.now()}`,
      role: "assistant",
      content: report,
      timestamp: Date.now(),
    });
    setOpen(false);
  };

  const handleReconcileAll = () => {
    runReconcile();
  };

  const handleStop = () => {
    cancelOperation();
  };

  const handleDismiss = () => {
    clearReport();
    setOpen(false);
  };

  const counts = lastReport ? findingCounts(lastReport.findings) : null;
  const hasFindings = counts && counts.total > 0;
  const fixedCount = lastReport ? lastReport.findings.filter((f) => f.fixed).length : 0;
  const fixedFindings = lastReport ? lastReport.findings.filter((f) => f.fixed) : [];
  const isBusy = isSyncing || isReconciling;

  return (
    <div className="relative" ref={dropdownRef}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen((v) => !v)}
        className={`mobile-sm-ok flex h-8 w-8 items-center justify-center rounded-lg border transition-all ${
          isBusy
            ? "border-amber-500/40 text-amber-400 sync-glow"
            : hasFindings
              ? "border-amber-500/30 text-amber-400/80 hover:border-amber-500/50 hover:text-amber-400"
              : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
        }`}
        title="Strategy Sync"
      >
        <InfinityIcon
          size={14}
          active={isBusy}
        />
      </button>

      {/* Dropdown */}
      {open && (
        <div className="absolute right-0 top-full z-50 mt-2 w-[300px] rounded-xl border border-border bg-card shadow-xl">
          {/* Header */}
          <div className="px-4 py-3">
            <div className="flex items-center gap-2 mb-1">
              <InfinityIcon size={12} active={isBusy} className={isBusy ? "text-amber-400" : "text-muted-foreground/60"} />
              <span className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60">
                Strategy Sync
              </span>
            </div>
            <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
              Reviews all decisions, documents, and conversation history for contradictions, gaps, and conflicts.
            </p>
          </div>

          <div className="h-px bg-border" />

          {/* Status / Results */}
          <div className="px-4 py-3">
            {isReconciling ? (
              /* Reconciling state */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-foreground thinking-shimmer">
                    Reconciling
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">
                    {reconciledCount} of {reconcileTotal}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-foreground/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-500/60 transition-all duration-500"
                    style={{ width: `${reconcileTotal > 0 ? (reconciledCount / reconcileTotal) * 100 : 0}%` }}
                  />
                </div>
                {reconcileCost > 0 && (
                  <p className="font-mono text-[10px] text-muted-foreground/40">
                    ${reconcileCost.toFixed(2)} so far
                  </p>
                )}
                {/* Real-time fix log during reconciliation */}
                {fixedFindings.length > 0 && (
                  <div className="max-h-[160px] overflow-y-auto space-y-1.5 pt-1 border-t border-border/50 mt-2">
                    {fixedFindings.map((f) => (
                      <div key={f.id} className="flex gap-1.5 items-start">
                        <span className="text-emerald-500 text-[10px] mt-px shrink-0">&#10003;</span>
                        <div className="min-w-0">
                          <p className="font-mono text-[10px] text-emerald-400/80 truncate">{f.title}</p>
                          {f.fixSummary && (
                            <p className="font-mono text-[9px] text-muted-foreground/40 line-clamp-2 leading-relaxed">{f.fixSummary}</p>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            ) : isSyncing && lastReport ? (
              /* Syncing state */
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="font-mono text-[11px] text-foreground thinking-shimmer">
                    Sync in progress
                  </span>
                  <span className="font-mono text-[10px] text-muted-foreground/50 tabular-nums">
                    Pass {lastReport.currentPass} of {lastReport.totalPasses}
                  </span>
                </div>
                <div className="h-1 w-full rounded-full bg-foreground/5 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-amber-500/60 transition-all duration-500"
                    style={{ width: `${(lastReport.currentPass / lastReport.totalPasses) * 100}%` }}
                  />
                </div>
                {lastReport.findings.length > 0 && (
                  <p className="font-mono text-[10px] text-amber-400/70">
                    {lastReport.findings.length} issue{lastReport.findings.length !== 1 ? "s" : ""} found so far
                  </p>
                )}
              </div>
            ) : lastReport?.status === "complete" && counts ? (
              /* Complete state */
              <div className="space-y-2">
                {counts.total === 0 ? (
                  <div className="space-y-2">
                    <div className="flex items-center gap-2">
                      <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
                      <span className="font-mono text-[11px] text-emerald-400">
                        {fixedCount > 0
                          ? `All clear. ${fixedCount} issue${fixedCount !== 1 ? "s" : ""} reconciled.`
                          : "All clear. Strategy is consistent."
                        }
                      </span>
                    </div>
                    {/* Fix log for reconciled findings */}
                    {fixedFindings.length > 0 && (
                      <div className="max-h-[160px] overflow-y-auto space-y-1.5 pt-1 border-t border-border/50">
                        {fixedFindings.map((f) => (
                          <div key={f.id} className="flex gap-1.5 items-start">
                            <span className="text-emerald-500 text-[10px] mt-px shrink-0">&#10003;</span>
                            <div className="min-w-0">
                              <p className="font-mono text-[10px] text-emerald-400/80 truncate">{f.title}</p>
                              {f.fixSummary && (
                                <p className="font-mono text-[9px] text-muted-foreground/40 line-clamp-2 leading-relaxed">{f.fixSummary}</p>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ) : (
                  <>
                    <div className="flex flex-wrap gap-x-3 gap-y-1">
                      {counts.contradictions > 0 && (
                        <span className="font-mono text-[11px] text-foreground">
                          {counts.contradictions} contradiction{counts.contradictions !== 1 ? "s" : ""}
                        </span>
                      )}
                      {counts.gaps > 0 && (
                        <span className="font-mono text-[11px] text-foreground">
                          {counts.gaps} gap{counts.gaps !== 1 ? "s" : ""}
                        </span>
                      )}
                      {counts.stale > 0 && (
                        <span className="font-mono text-[11px] text-foreground">
                          {counts.stale} stale
                        </span>
                      )}
                      {counts.conflicts > 0 && (
                        <span className="font-mono text-[11px] text-foreground">
                          {counts.conflicts} conflict{counts.conflicts !== 1 ? "s" : ""}
                        </span>
                      )}
                    </div>
                    {fixedCount > 0 && (
                      <p className="font-mono text-[10px] text-emerald-400/70">
                        {fixedCount} issue{fixedCount !== 1 ? "s" : ""} reconciled
                      </p>
                    )}
                    <button
                      onClick={handleViewReport}
                      className="w-full rounded-lg border border-foreground/20 bg-transparent py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-foreground/5 hover:text-foreground"
                    >
                      View full report
                    </button>
                  </>
                )}
                <p className="font-mono text-[10px] text-muted-foreground/30">
                  Last synced {timeAgo(lastReport.timestamp)}
                  {lastReport.cost > 0 && ` · $${lastReport.cost.toFixed(2)}`}
                  {reconcileCost > 0 && ` · reconcile $${reconcileCost.toFixed(2)}`}
                </p>
                {reconcileError && (
                  <p className="font-mono text-[10px] text-red-400/70">
                    Reconcile error: {reconcileError}
                  </p>
                )}
              </div>
            ) : lastReport?.status === "error" ? (
              /* Error state */
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <span className="h-1.5 w-1.5 rounded-full bg-red-500" />
                  <span className="font-mono text-[11px] text-red-400">Sync failed</span>
                </div>
                <p className="font-mono text-[10px] text-muted-foreground/40">
                  {lastReport.error ?? "Unknown error"}
                </p>
              </div>
            ) : (
              /* Idle / never synced */
              <div className="space-y-1">
                <span className="font-mono text-[11px] text-muted-foreground/50">
                  No sync run yet.
                </span>
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* Action — context-aware buttons */}
          <div className="px-4 py-3 space-y-2">
            {isBusy ? (
              /* Busy state — Stop + Dismiss */
              <>
                <button
                  onClick={handleStop}
                  className="w-full rounded-lg border border-red-500/30 bg-red-500/10 py-2 font-mono text-[11px] text-red-400 transition-colors hover:border-red-500/40 hover:bg-red-500/15"
                >
                  Stop
                </button>
                <div className="flex items-center justify-center">
                  <button
                    onClick={handleDismiss}
                    className="font-mono text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : hasFindings ? (
              /* Has active findings — Reconcile primary, Re-sync + Dismiss secondary */
              <>
                <button
                  onClick={handleReconcileAll}
                  className="w-full rounded-lg border border-amber-500/30 bg-amber-500/10 py-2 font-mono text-[11px] text-amber-400 transition-colors hover:border-amber-500/40 hover:bg-amber-500/15"
                >
                  Reconcile all
                </button>
                <div className="flex items-center justify-center gap-3">
                  <button
                    onClick={handleStartSync}
                    className="font-mono text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                  >
                    Re-sync
                  </button>
                  <span className="text-muted-foreground/20">·</span>
                  <button
                    onClick={handleDismiss}
                    className="font-mono text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : lastReport?.status === "complete" ? (
              /* All clear / post-reconcile — Re-sync primary, Dismiss secondary */
              <>
                <button
                  onClick={handleStartSync}
                  className="w-full rounded-lg py-2 font-mono text-[11px] bg-foreground/10 text-foreground hover:bg-foreground/15 transition-colors"
                >
                  Re-sync
                </button>
                <div className="flex items-center justify-center">
                  <button
                    onClick={handleDismiss}
                    className="font-mono text-[10px] text-muted-foreground/40 hover:text-muted-foreground/60 transition-colors"
                  >
                    Dismiss
                  </button>
                </div>
              </>
            ) : (
              /* Idle / never synced / error — Sync now */
              <>
                <button
                  onClick={handleStartSync}
                  className="w-full rounded-lg py-2 font-mono text-[11px] bg-foreground/10 text-foreground hover:bg-foreground/15 transition-colors"
                >
                  Sync now
                </button>
                <p className="font-mono text-[9px] text-muted-foreground/25 leading-relaxed text-center">
                  Uses Sonnet 4.6 to analyze your full strategy. Runs in background.
                </p>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
