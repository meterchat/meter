"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { useMeterStore } from "@/lib/store";
import { MeterIcon } from "./meter-icon";
import { useIsMobile } from "@/hooks/use-mobile";

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

function startOfMonth(): number {
  const now = new Date();
  const first = new Date(now.getFullYear(), now.getMonth(), 1);
  return first.getTime();
}

export function HeaderMeter() {
  const [open, setOpen] = useState(false);
  const [remaining, setRemaining] = useState(getMsUntilMidnight);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const isMobile = useIsMobile();

  const projects = useMeterStore((s) => s.projects);
  const activeProjectId = useMeterStore((s) => s.activeProjectId);
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const isStreaming = activeProject?.isStreaming ?? false;

  const assistantMsgs = useMemo(
    () => (activeProject?.messages ?? []).filter((m) => m.role === "assistant" && m.cost != null),
    [activeProject]
  );

  const usage = useMemo(() => {
    const now = Date.now();
    const dayMs = 24 * 60 * 60 * 1000;
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);
    const startOfDayTs = startOfDay.getTime();
    const weekStart = startOfWeek();
    const monthStart = startOfMonth();

    const today = activeProject?.todayCost ?? 0;
    const week = assistantMsgs
      .filter((m) => (m.timestamp ?? 0) >= weekStart)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const month = assistantMsgs
      .filter((m) => (m.timestamp ?? 0) >= monthStart)
      .reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const lifetimeFromMessages = assistantMsgs.reduce((sum, m) => sum + (m.cost ?? 0), 0);
    const lifetime = Math.max(lifetimeFromMessages, activeProject?.totalCost ?? 0);

    const daysIntoWeek = Math.max(1, Math.floor((startOfDayTs - weekStart) / dayMs) + 1);
    const daysIntoMonth = Math.max(1, new Date().getDate());
    const weekAvg = week / daysIntoWeek;
    const monthAvg = month / daysIntoMonth;

    const totalTokensIn = assistantMsgs.reduce((sum, m) => sum + (m.tokensIn ?? 0), 0);
    const totalTokensOut = assistantMsgs.reduce((sum, m) => sum + (m.tokensOut ?? 0), 0);
    const totalMessages = assistantMsgs.length;
    const settledCount = assistantMsgs.filter((m) => m.settled).length;
    const pendingCount = assistantMsgs.filter((m) => !m.settled).length;

    const byModel: Record<string, { cost: number; count: number }> = {};
    for (const m of assistantMsgs) {
      const key = m.model ?? "unknown";
      const existing = byModel[key] || { cost: 0, count: 0 };
      byModel[key] = { cost: existing.cost + (m.cost ?? 0), count: existing.count + 1 };
    }

    return {
      today,
      week,
      month,
      lifetime,
      weekAvg,
      monthAvg,
      totalTokensIn,
      totalTokensOut,
      totalMessages,
      settledCount,
      pendingCount,
      byModel,
    };
  }, [assistantMsgs, activeProject?.totalCost, activeProject?.todayCost]);

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
        <span className="tabular-nums text-[12px] text-foreground">{costStr}</span>
        {!isMobile && (
          <span className="text-[11px] text-muted-foreground/50 uppercase tracking-wider">
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
          <div className="border-b border-border/50 px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-1.5">
              Resets in
            </div>
            <div className="font-mono text-lg tabular-nums text-foreground">
              {formatCountdown(remaining)}
            </div>
            <p className="mt-1.5 font-mono text-[11px] leading-relaxed text-muted-foreground/50">
              Today&apos;s spend resets at midnight local time.
            </p>
          </div>

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
          </div>

          <div className="h-px bg-border" />

          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Activity
            </div>
            <StatRow label="Messages" value={usage.totalMessages.toString()} />
            <StatRow label="Tokens In" value={usage.totalTokensIn.toLocaleString()} />
            <StatRow label="Tokens Out" value={usage.totalTokensOut.toLocaleString()} />
            <StatRow label="Settled" value={usage.settledCount.toString()} />
            <StatRow label="Pending" value={usage.pendingCount.toString()} />
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
