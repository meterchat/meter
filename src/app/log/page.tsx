"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { apiUrl } from "@/lib/api-url";

// ── Types ────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  type: string;
  actor: string;
  commit_sha?: string;
  commit_url?: string;
  commit_repo?: string;
  created_at: string;
}

interface Decision {
  id: string;
  title: string;
  choice?: string;
  reasoning?: string;
  category?: string;
  version: number;
  revisitCount: number;
  createdAt: number;
  updatedAt: number;
}

interface LogStats {
  totalSpend: number;
  todaySpend: number;
  weekSpend: number;
  monthSpend: number;
  dailyAverage: number;
  weeklyAverage: number;
  monthlyAverage: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalMessages: number;
  byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }>;
  counts: { debates: number; dissects: number; forks: number; documents: number };
}

// ── Helpers ──────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  message_sent: "sent message",
  decision_locked: "locked decision",
  debate_started: "started debate",
  path_forked: "forked path",
  path_merged: "merged path",
  workspace_created: "created workspace",
  feedback_logged: "logged feedback",
  commit_pushed: "commit pushed",
};

const EVENT_DOTS: Record<string, string> = {
  message_sent: "bg-foreground/20",
  decision_locked: "bg-emerald-500",
  debate_started: "bg-amber-500",
  path_forked: "bg-indigo-500",
  path_merged: "bg-teal-500",
  workspace_created: "bg-blue-500",
  feedback_logged: "bg-purple-500",
  commit_pushed: "bg-foreground/40",
};

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months}mo ago`;
  const years = Math.floor(months / 12);
  return `${years}y ago`;
}

function exactTime(dateStr: string): string {
  return new Date(dateStr).toLocaleString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

function formatActor(actor: string, type: string): string {
  if (type === "commit_pushed") return "meter";
  if (actor === "anon") return "anon";
  return actor;
}

// ── MeterBar (header dropdown) ───────────────────────────────

function LogMeterBar() {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<LogStats | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    fetch(apiUrl("/api/log/stats"))
      .then((r) => r.json())
      .then((d) => setStats(d))
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      >
        {/* Meter icon */}
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-amber-500">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <span className="tabular-nums text-[12px] text-foreground">
          ${(stats?.totalSpend ?? 0).toFixed(2)}
        </span>
        <span className="text-[11px] text-muted-foreground/50 uppercase tracking-wider">
          TOTAL
        </span>
        <svg
          width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && stats && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[340px] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
          {/* Spend Overview */}
          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Spend
            </div>
            <div className="space-y-1.5">
              <StatSpendRow label="Total to date" amount={stats.totalSpend} />
              <StatSpendRow label="Today" amount={stats.todaySpend} />
              <StatSpendRow label="Daily average" amount={stats.dailyAverage} />
              <StatSpendRow label="Weekly average" amount={stats.weeklyAverage} />
              <StatSpendRow label="Monthly average" amount={stats.monthlyAverage} />
            </div>
          </div>

          <div className="h-px bg-border" />

          {/* Tokens */}
          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Tokens
            </div>
            <StatRow label="Total In" value={(stats.totalTokensIn).toLocaleString()} />
            <StatRow label="Total Out" value={(stats.totalTokensOut).toLocaleString()} />
            <StatRow label="Messages" value={stats.totalMessages.toLocaleString()} />
          </div>

          {/* By Model */}
          {Object.keys(stats.byModel).length > 0 && (
            <>
              <div className="h-px bg-border" />
              <div className="px-4 py-3">
                <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
                  By Model
                </div>
                {Object.entries(stats.byModel)
                  .sort(([, a], [, b]) => b.cost - a.cost)
                  .map(([model, data]) => (
                  <div key={model} className="flex items-center justify-between py-1">
                    <span className="text-[11px] text-muted-foreground truncate max-w-[180px]">{model}</span>
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-foreground font-mono tabular-nums">
                        ${data.cost.toFixed(2)}
                      </span>
                      <span className="text-[10px] text-muted-foreground/40 font-mono">
                        {data.count} msgs
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}

          {/* Activity counts */}
          <div className="h-px bg-border" />
          <div className="px-4 py-3">
            <div className="font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Activity
            </div>
            <StatRow label="Debates" value={stats.counts.debates.toString()} />
            <StatRow label="Forks" value={stats.counts.forks.toString()} />
          </div>
        </div>
      )}
    </div>
  );
}

function StatSpendRow({ label, amount }: { label: string; amount: number }) {
  return (
    <div className="flex items-center justify-between">
      <span className="font-mono text-[12px] text-muted-foreground/70">{label}</span>
      <span className="font-mono text-[12px] tabular-nums text-foreground">${amount.toFixed(2)}</span>
    </div>
  );
}

function StatRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-[12px] text-muted-foreground">{label}</span>
      <span className="text-[12px] text-foreground font-mono">{value}</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────

export default function LogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState<"feed" | "decisions">("feed");
  const feedEndRef = useRef<HTMLDivElement>(null);
  const feedContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  const handleScroll = useCallback(() => {
    const el = feedContainerRef.current;
    if (!el) return;
    const threshold = 50;
    setIsAtBottom(el.scrollHeight - el.scrollTop - el.clientHeight < threshold);
  }, []);

  // Fetch data
  useEffect(() => {
    async function load() {
      try {
        const [entriesRes, decisionsRes] = await Promise.all([
          fetch(apiUrl("/api/log?limit=200")),
          fetch(apiUrl("/api/log/decisions")),
        ]);
        const entriesData = await entriesRes.json();
        const decisionsData = await decisionsRes.json();
        setEntries(entriesData.entries ?? []);
        setDecisions(decisionsData.decisions ?? []);
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

  // Auto-scroll to bottom on initial load (logs start at bottom)
  useEffect(() => {
    if (!loading && entries.length > 0) {
      setTimeout(() => scrollToBottom(), 100);
    }
  }, [loading, entries.length, scrollToBottom]);

  // Poll for new entries every 15s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await fetch(apiUrl("/api/log?limit=200"));
        const data = await res.json();
        const newEntries = data.entries ?? [];
        setEntries((prev: LogEntry[]) => {
          if (newEntries.length !== prev.length) {
            if (isAtBottom) {
              setTimeout(() => scrollToBottom(), 100);
            }
            return newEntries;
          }
          return prev;
        });
      } catch {
        // Silent
      }
    }, 15000);
    return () => clearInterval(interval);
  }, [isAtBottom, scrollToBottom]);

  const isMobile = typeof window !== "undefined" && window.innerWidth < 768;

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-background font-mono text-xs text-muted-foreground/40">
        loading...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col overflow-hidden bg-background text-foreground">
      {/* Header */}
      <header className="flex items-center justify-between px-6 py-3 border-b border-border bg-background">
        <div className="flex items-center gap-3">
          <span className="font-mono text-sm font-semibold tracking-tight text-foreground">Meter Log</span>
          <span className="font-mono text-[10px] text-muted-foreground/50">live feed</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Mobile tab switcher */}
          {isMobile && (
            <div className="flex gap-1">
              <button
                onClick={() => setMobileTab("feed")}
                className={`px-2 py-1 font-mono text-[10px] rounded transition-colors ${mobileTab === "feed" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"}`}
              >
                feed
              </button>
              <button
                onClick={() => setMobileTab("decisions")}
                className={`px-2 py-1 font-mono text-[10px] rounded transition-colors ${mobileTab === "decisions" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"}`}
              >
                decisions
              </button>
            </div>
          )}
          {/* MeterBar */}
          <LogMeterBar />
        </div>
      </header>

      {/* Main content — 50:50 split */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Feed (50%) */}
        <div
          className={`${isMobile && mobileTab !== "feed" ? "hidden" : ""} ${isMobile ? "w-full" : "w-1/2"} flex flex-col bg-background`}
        >
          <div
            ref={feedContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
          >
            <div className="px-6 py-4 flex flex-col">
              {entries.length === 0 ? (
                <div className="font-mono text-xs text-muted-foreground/40 py-12 text-center">
                  no activity yet
                </div>
              ) : (
                entries.map((entry) => (
                  <LogRow key={entry.id} entry={entry} />
                ))
              )}
              <div ref={feedEndRef} />
            </div>
          </div>

          {/* Scroll to bottom button */}
          {!isAtBottom && entries.length > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 left-[25%] -translate-x-1/2 px-3 py-1.5 rounded-full font-mono text-[10px] border border-border bg-card text-foreground shadow-lg hover:opacity-80 transition-opacity"
            >
              ↓ latest
            </button>
          )}
        </div>

        {/* Right: Decisions panel (50%) */}
        <div
          className={`${isMobile && mobileTab !== "decisions" ? "hidden" : ""} ${isMobile ? "w-full" : "w-1/2"} flex flex-col border-l border-border bg-card`}
        >
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">Decisions</h2>
            <p className="font-mono text-[10px] text-muted-foreground/50 mt-0.5">
              {decisions.length} locked decision{decisions.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-2">
            {decisions.length === 0 ? (
              <div className="font-mono text-xs text-muted-foreground/40 py-12 text-center">
                no decisions yet
              </div>
            ) : (
              decisions.map((d) => (
                <DecisionCard key={d.id} decision={d} />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Log Row ──────────────────────────────────────────────────

function LogRow({ entry }: { entry: LogEntry }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const actor = formatActor(entry.actor, entry.type);
  const action = EVENT_LABELS[entry.type] ?? entry.type;
  const dotColor = EVENT_DOTS[entry.type] ?? "bg-foreground/20";

  return (
    <div
      className="flex items-center justify-between py-[3px] group"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-center gap-2 font-mono text-[12px] min-w-0">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-muted-foreground shrink-0">{actor}</span>
        <span className="text-foreground/60">{action}</span>
        {entry.commit_sha && (
          <span className="text-muted-foreground/40 text-[10px]">
            {entry.commit_url ? (
              <a
                href={entry.commit_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline hover:text-foreground/60"
              >
                {entry.commit_sha}
              </a>
            ) : (
              entry.commit_sha
            )}
          </span>
        )}
      </div>
      <div className="relative shrink-0 ml-4">
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {relativeTime(entry.created_at)}
        </span>
        {showTooltip && (
          <div className="absolute bottom-full right-0 mb-1 px-2 py-1 rounded bg-popover border border-border text-foreground text-[10px] font-mono whitespace-nowrap z-10 shadow-lg">
            {exactTime(entry.created_at)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Decision Card ────────────────────────────────────────────

function DecisionCard({ decision }: { decision: Decision }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div
      className="rounded-lg border border-border p-3 flex flex-col gap-1.5 cursor-pointer transition-colors hover:bg-foreground/[0.02]"
      onClick={() => setExpanded(!expanded)}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-[12px] font-medium leading-tight text-foreground">{decision.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {decision.category && (
            <span className="font-mono text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border border-border text-muted-foreground/60">
              {decision.category}
            </span>
          )}
          {decision.version > 1 && (
            <span className="font-mono text-[9px] text-muted-foreground/50">v{decision.version}</span>
          )}
        </div>
      </div>
      {decision.choice && (
        <p className="font-mono text-[11px] text-muted-foreground leading-relaxed">{decision.choice}</p>
      )}
      {expanded && decision.reasoning && (
        <div className="mt-1 pt-1.5 border-t border-border/50">
          <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/40">Reasoning</span>
          <p className="font-mono text-[11px] text-muted-foreground/70 mt-0.5">{decision.reasoning}</p>
        </div>
      )}
      <span className="font-mono text-[9px] text-muted-foreground/40">
        {relativeTime(new Date(decision.updatedAt).toISOString())}
      </span>
    </div>
  );
}
