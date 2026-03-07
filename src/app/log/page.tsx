"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import dynamic from "next/dynamic";
import { apiUrl } from "@/lib/api-url";

const Liveline = dynamic(() => import("liveline").then((m) => m.Liveline), {
  ssr: false,
  loading: () => <div className="h-[80px] bg-foreground/[0.02] rounded animate-pulse" />,
});

// ── Types ────────────────────────────────────────────────────

interface LogEntry {
  id: string;
  type: string;
  actor: string;
  commit_sha?: string;
  commit_url?: string;
  commit_repo?: string;
  feedback_text?: string;
  created_at: string;
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
  spendTimeline: { time: number; value: number }[];
  tokensTimeline: { time: number; value: number }[];
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

// ── Meter Icon (animated sprite, same as main app) ───────────

const FRAMES = [
  "/frame-1.png",
  "/frame-2.png",
  "/frame-3.png",
  "/frame-4.png",
  "/frame-5.png",
  "/frame-6.png",
];

if (typeof window !== "undefined") {
  FRAMES.forEach((src) => {
    const img = new window.Image();
    img.src = src;
  });
}

const LogMeterIcon = memo(function LogMeterIcon({ active, size = 14 }: { active: boolean; size?: number }) {
  const [frame, setFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  useEffect(() => {
    imagesRef.current = FRAMES.map((src) => {
      const img = new window.Image();
      img.src = src;
      return img;
    });
  }, []);

  useEffect(() => {
    if (!active) {
      setFrame(0);
      return;
    }
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, [active]);

  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[active ? frame : 0];
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (img.complete) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
    } else {
      img.onload = () => {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
      };
    }
  }, [frame, active, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
});

// ── MeterBar (header dropdown) ───────────────────────────────

function LogMeterBar({ entryCount }: { entryCount: number }) {
  const [open, setOpen] = useState(false);
  const [stats, setStats] = useState<LogStats | null>(null);
  const [iconActive, setIconActive] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const prevEntryCount = useRef<number | null>(null);

  useEffect(() => {
    fetch(apiUrl("/api/log/stats"))
      .then((r) => r.json())
      .then((d) => {
        if (d && typeof d.totalSpend === "number") setStats(d);
      })
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

  useEffect(() => {
    if (prevEntryCount.current === null) {
      prevEntryCount.current = entryCount;
      return;
    }
    if (entryCount > prevEntryCount.current) {
      setIconActive(true);
      const timeout = setTimeout(() => setIconActive(false), 2000);
      prevEntryCount.current = entryCount;
      return () => clearTimeout(timeout);
    }
    prevEntryCount.current = entryCount;
  }, [entryCount]);

  // Compute window size to cover full timeline range
  const spendWindow = stats?.spendTimeline && stats.spendTimeline.length > 1
    ? Math.ceil(stats.spendTimeline[stats.spendTimeline.length - 1].time - stats.spendTimeline[0].time) + 86400
    : 86400;
  const tokensWindow = stats?.tokensTimeline && stats.tokensTimeline.length > 1
    ? Math.ceil(stats.tokensTimeline[stats.tokensTimeline.length - 1].time - stats.tokensTimeline[0].time) + 86400
    : 86400;

  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex h-8 items-center gap-2 rounded-lg border border-border px-2.5 font-mono text-[11px] text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      >
        <LogMeterIcon active={iconActive} size={14} />
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

      {open && (
        <div className="absolute top-full right-0 z-50 mt-2 w-[340px] max-h-[70vh] overflow-y-auto rounded-xl border border-border bg-card shadow-xl">
          {!stats ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-muted-foreground/40">
              loading stats...
            </div>
          ) : (
          <>
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
            {Array.isArray(stats.spendTimeline) && stats.spendTimeline.length > 1 && (
              <div className="mt-2 h-[80px]">
                <Liveline
                  data={stats.spendTimeline}
                  value={stats.totalSpend}
                  window={spendWindow}
                  theme="dark"
                  color="#f59e0b"
                  grid={false}
                  badge={false}
                  fill
                  pulse={false}
                  momentum={false}
                  scrub
                  formatValue={(v: number) => `$${v.toFixed(2)}`}
                />
              </div>
            )}
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
            {Array.isArray(stats.tokensTimeline) && stats.tokensTimeline.length > 1 && (
              <div className="mt-2 h-[80px]">
                <Liveline
                  data={stats.tokensTimeline}
                  value={stats.totalTokensIn + stats.totalTokensOut}
                  window={tokensWindow}
                  theme="dark"
                  color="#3b82f6"
                  grid={false}
                  badge={false}
                  fill
                  pulse={false}
                  momentum={false}
                  scrub
                  formatValue={(v: number) => v.toLocaleString()}
                />
              </div>
            )}
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
          </>
          )}
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

// ── Entry Detail Panel ────────────────────────────────────────

function EntryDetail({ entry }: { entry: LogEntry }) {
  const dotColor = EVENT_DOTS[entry.type] ?? "bg-foreground/20";
  const label = EVENT_LABELS[entry.type] ?? entry.type;

  return (
    <div className="px-6 py-6 flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-center gap-2">
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="font-mono text-[13px] font-medium text-foreground">{label}</span>
      </div>

      {/* Metadata */}
      <div className="space-y-2">
        <DetailRow label="Actor" value={formatActor(entry.actor, entry.type)} />
        <DetailRow label="Time" value={exactTime(entry.created_at)} />
        <DetailRow label="Relative" value={relativeTime(entry.created_at)} />
        <DetailRow label="Type" value={entry.type} />
        <DetailRow label="ID" value={entry.id} />
      </div>

      {/* Commit details */}
      {entry.type === "commit_pushed" && (entry.commit_sha || entry.commit_repo) && (
        <>
          <div className="h-px bg-border" />
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
              Commit
            </div>
            {entry.commit_repo && (
              <DetailRow label="Repo" value={entry.commit_repo} />
            )}
            {entry.commit_sha && (
              <div className="flex items-start justify-between gap-4">
                <span className="font-mono text-[11px] text-muted-foreground/60 shrink-0">SHA</span>
                {entry.commit_url ? (
                  <a
                    href={entry.commit_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="font-mono text-[11px] text-blue-400 hover:text-blue-300 text-right break-all"
                  >
                    {entry.commit_sha}
                  </a>
                ) : (
                  <span className="font-mono text-[11px] text-foreground text-right break-all">
                    {entry.commit_sha}
                  </span>
                )}
              </div>
            )}
          </div>
        </>
      )}

      {/* Feedback text */}
      {entry.type === "feedback_logged" && entry.feedback_text && (
        <>
          <div className="h-px bg-border" />
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
              Feedback
            </div>
            <p className="font-mono text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
              {entry.feedback_text}
            </p>
          </div>
        </>
      )}

      {/* Debate info */}
      {entry.type === "debate_started" && (
        <>
          <div className="h-px bg-border" />
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
              Debate
            </div>
            <p className="font-mono text-[11px] text-muted-foreground/60">
              Multi-model debate initiated by {formatActor(entry.actor, entry.type)}
            </p>
          </div>
        </>
      )}

      {/* Workspace created */}
      {entry.type === "workspace_created" && (
        <>
          <div className="h-px bg-border" />
          <div className="space-y-2">
            <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
              Workspace
            </div>
            <p className="font-mono text-[11px] text-muted-foreground/60">
              New workspace created by {formatActor(entry.actor, entry.type)}
            </p>
          </div>
        </>
      )}
    </div>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4">
      <span className="font-mono text-[11px] text-muted-foreground/60 shrink-0">{label}</span>
      <span className="font-mono text-[11px] text-foreground text-right break-all">{value}</span>
    </div>
  );
}

// ── Main Page ────────────────────────────────────────────────

export default function LogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [selectedEntry, setSelectedEntry] = useState<LogEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [mobileTab, setMobileTab] = useState<"feed" | "detail">("feed");
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

  useEffect(() => {
    async function load() {
      try {
        const res = await fetch(apiUrl("/api/log?limit=200"));
        const data = await res.json();
        setEntries((data.entries ?? []).reverse());
      } catch {
        // Silent fail
      } finally {
        setLoading(false);
      }
    }
    load();
  }, []);

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
        const newEntries = (data.entries ?? []).reverse();
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

  const handleSelectEntry = useCallback((entry: LogEntry) => {
    setSelectedEntry(entry);
    setMobileTab("detail");
  }, []);

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
          {isMobile && (
            <div className="flex gap-1">
              <button
                onClick={() => setMobileTab("feed")}
                className={`px-2 py-1 font-mono text-[10px] rounded transition-colors ${mobileTab === "feed" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"}`}
              >
                feed
              </button>
              <button
                onClick={() => setMobileTab("detail")}
                className={`px-2 py-1 font-mono text-[10px] rounded transition-colors ${mobileTab === "detail" ? "bg-foreground/10 text-foreground" : "text-muted-foreground"}`}
              >
                detail
              </button>
            </div>
          )}
          <LogMeterBar entryCount={entries.length} />
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
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    selected={selectedEntry?.id === entry.id}
                    onSelect={handleSelectEntry}
                  />
                ))
              )}
              <div ref={feedEndRef} />
            </div>
          </div>

          {!isAtBottom && entries.length > 0 && (
            <button
              onClick={scrollToBottom}
              className="absolute bottom-4 left-[25%] -translate-x-1/2 px-3 py-1.5 rounded-full font-mono text-[10px] border border-border bg-card text-foreground shadow-lg hover:opacity-80 transition-opacity"
            >
              ↓ latest
            </button>
          )}
        </div>

        {/* Right: Detail panel (50%) */}
        <div
          className={`${isMobile && mobileTab !== "detail" ? "hidden" : ""} ${isMobile ? "w-full" : "w-1/2"} flex flex-col border-l border-border bg-card`}
        >
          <div className="px-6 py-4 border-b border-border">
            <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-foreground">Detail</h2>
            <p className="font-mono text-[10px] text-muted-foreground/50 mt-0.5">
              {selectedEntry ? "click an event to inspect" : "select an event from the feed"}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto">
            {!selectedEntry ? (
              <div className="font-mono text-xs text-muted-foreground/40 py-12 text-center">
                select an event from the feed
              </div>
            ) : (
              <EntryDetail entry={selectedEntry} />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Log Row ──────────────────────────────────────────────────

function LogRow({ entry, selected, onSelect }: { entry: LogEntry; selected: boolean; onSelect: (e: LogEntry) => void }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const actor = formatActor(entry.actor, entry.type);
  const action = EVENT_LABELS[entry.type] ?? entry.type;
  const dotColor = EVENT_DOTS[entry.type] ?? "bg-foreground/20";

  return (
    <div
      className={`flex items-center justify-between py-[3px] group cursor-pointer rounded-sm px-1 -mx-1 transition-colors ${selected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => onSelect(entry)}
    >
      <div className="flex items-center gap-2 font-mono text-[12px] min-w-0">
        <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-muted-foreground shrink-0">{actor}</span>
        <span className="text-foreground/60">{action}</span>
        {entry.commit_sha && (
          <span className="text-muted-foreground/40 text-[10px]">
            {entry.commit_sha}
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
