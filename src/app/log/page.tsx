"use client";

import { useState, useEffect, useRef, useCallback, memo } from "react";
import dynamic from "next/dynamic";
import { authFetch } from "@/lib/auth-fetch";
import { AdminConfigButton } from "@/components/admin-config-panel";

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
  commit_message?: string;
  feedback_text?: string;
  preview?: string;
  created_at: string;
}

interface EnrichmentData {
  userMessage?: { content: string; model?: string; cost?: number; tokens_in?: number; tokens_out?: number; created_at: string };
  debateMessage?: { content: string; cost?: number; tokens_in?: number; tokens_out?: number; debate_trace?: { model: string; phase: string; content: string }[]; created_at: string };
  decision?: { title: string; choice?: string; reasoning?: string; category?: string };
}

interface LogStats {
  totalSpend: number;
  todaySpend: number;
  weekSpend: number;
  monthSpend: number;
  dailyAverage: number;
  weeklyAverage: number;
  monthlyAverage: number;
  totalSettled: number;
  todaySettled: number;
  paymentFees: number;
  inferenceCost: number;
  totalProfit: number;
  profitTimeline: { time: number; value: number }[];
  totalTokensIn: number;
  totalTokensOut: number;
  totalMessages: number;
  byModel: Record<string, { cost: number; count: number; tokensIn: number; tokensOut: number }>;
  counts: { debates: number; dissects: number; forks: number; documents: number };
  spendTimeline: { time: number; value: number }[];
  tokensTimeline: { time: number; value: number }[];
  messagesTimeline: { time: number; value: number }[];
}

// ── Helpers ──────────────────────────────────────────────────

const EVENT_LABELS: Record<string, string> = {
  message_sent: "sent message",
  decision_locked: "locked decision",
  debate_started: "started debate",
  debate_completed: "debate completed",
  path_forked: "forked path",
  path_merged: "merged path",
  workspace_created: "created workspace",
  feedback_logged: "logged feedback",
  commit_pushed: "commit pushed",
  payment_succeeded: "payment",
  payment_failed: "payment failed",
  auth_hold_created: "card authorized",
  refund_issued: "refund",
  account_created: "signed up",
  user_logged_in: "logged in",
  account_deleted: "account deleted",
  artifacts_pushed: "pushed artifacts",
  decision_created: "created decision",
  connector_connected: "connected app",
  card_saved: "card saved",
};

const EVENT_DOTS: Record<string, string> = {
  message_sent: "bg-violet-400",
  decision_locked: "bg-emerald-500",
  debate_started: "bg-amber-500",
  debate_completed: "bg-amber-300",
  path_forked: "bg-indigo-500",
  path_merged: "bg-teal-500",
  workspace_created: "bg-cyan-500",
  feedback_logged: "bg-purple-500",
  commit_pushed: "bg-blue-500",
  payment_succeeded: "bg-green-500",
  payment_failed: "bg-red-500",
  auth_hold_created: "bg-yellow-500",
  refund_issued: "bg-rose-500",
  account_created: "bg-lime-500",
  user_logged_in: "bg-sky-400",
  account_deleted: "bg-red-400",
  artifacts_pushed: "bg-blue-400",
  decision_created: "bg-emerald-400",
  connector_connected: "bg-orange-500",
  card_saved: "bg-green-400",
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

function getEntryTitle(entry: LogEntry): string {
  switch (entry.type) {
    case "commit_pushed":
      return entry.commit_message?.split("\n")[0] ?? entry.commit_sha ?? "commit pushed";
    case "message_sent":
      return entry.preview || entry.feedback_text || "sent message";
    case "debate_started":
      return "multi-model debate";
    case "decision_locked":
      return "locked decision";
    case "feedback_logged":
      return entry.feedback_text?.slice(0, 80) ?? "logged feedback";
    case "path_forked":
      return "forked path";
    case "path_merged":
      return "merged paths";
    case "workspace_created":
      return "created workspace";
    case "payment_succeeded":
    case "payment_failed":
    case "auth_hold_created":
    case "refund_issued":
      return entry.preview || EVENT_LABELS[entry.type] || entry.type;
    default:
      return EVENT_LABELS[entry.type] ?? entry.type;
  }
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

  // Live data state — continuously updated so Liveline scrolls forward
  const [spendLive, setSpendLive] = useState<{ time: number; value: number }[]>([]);
  const [profitLive, setProfitLive] = useState<{ time: number; value: number }[]>([]);
  const [messagesLive, setMessagesLive] = useState<{ time: number; value: number }[]>([]);
  const [spendWindow, setSpendWindow] = useState(604800); // default 1w
  const [profitWindow, setProfitWindow] = useState(604800);
  const [messagesWindow, setMessagesWindow] = useState(604800);

  // Refs so the formatTime closure always reads the latest window value
  // (Liveline's canvas rAF loop may hold a stale function reference)
  const spendWindowRef = useRef(spendWindow);
  spendWindowRef.current = spendWindow;
  const profitWindowRef = useRef(profitWindow);
  profitWindowRef.current = profitWindow;
  const messagesWindowRef = useRef(messagesWindow);
  messagesWindowRef.current = messagesWindow;

  useEffect(() => {
    authFetch("/api/log/stats")
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

  // Seed live data from stats, then push a "now" point every second so
  // Liveline continuously scrolls forward like the heartbeat chart.
  useEffect(() => {
    if (!stats) return;
    const seed = (timeline: { time: number; value: number }[], latestVal: number) => {
      const now = Math.floor(Date.now() / 1000);
      if (!timeline || timeline.length === 0) return [{ time: now - 60, value: 0 }, { time: now, value: latestVal }];
      return [...timeline, { time: now, value: latestVal }];
    };
    setSpendLive(seed(stats.spendTimeline, stats.totalSpend));
    setProfitLive(seed(stats.profitTimeline, stats.totalProfit));
    setMessagesLive(seed(stats.messagesTimeline, stats.totalMessages));

    const interval = setInterval(() => {
      const now = Math.floor(Date.now() / 1000);
      setSpendLive((prev) => [...prev, { time: now, value: prev[prev.length - 1]?.value ?? 0 }]);
      setProfitLive((prev) => [...prev, { time: now, value: prev[prev.length - 1]?.value ?? 0 }]);
      setMessagesLive((prev) => [...prev, { time: now, value: prev[prev.length - 1]?.value ?? 0 }]);
    }, 1000);
    return () => clearInterval(interval);
  }, [stats]);

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
        <div className="absolute top-full right-0 z-50 mt-2 w-[340px] max-h-[70vh] overflow-y-auto overflow-x-hidden rounded-xl border border-border bg-card shadow-xl">
          {!stats ? (
            <div className="px-4 py-6 text-center font-mono text-[11px] text-muted-foreground/40">
              loading stats...
            </div>
          ) : (
          <>
          {/* Spend Overview */}
          <div className="py-3">
            <div className="px-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Spend
            </div>
            <div className="px-4 space-y-1.5">
              <StatSpendRow label="Total to date" amount={stats.totalSpend} />
              <StatSpendRow label="Today" amount={stats.todaySpend} />
              <StatSpendRow label="Daily average" amount={stats.dailyAverage} />
              <StatSpendRow label="Weekly average" amount={stats.weeklyAverage} />
              <StatSpendRow label="Monthly average" amount={stats.monthlyAverage} />
            </div>
            {spendLive.length > 1 && (
              <div className="mt-2 py-2 h-[200px]">
                <Liveline
                  data={spendLive}
                  value={stats.totalSpend}
                  window={spendWindow}
                  theme="dark"
                  color="#f59e0b"
                  grid
                  badge={false}
                  fill
                  pulse
                  momentum={false}
                  scrub
                  exaggerate
                  formatValue={(v: number) => `$${v.toFixed(2)}`}
                  formatTime={(t: number) => {
                    const d = new Date(t * 1000);
                    const w = spendWindowRef.current;
                    if (w <= 60) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    if (w <= 86400) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  }}
                  windows={[
                    { label: "1mo", secs: 2592000 },
                    { label: "1w", secs: 604800 },
                    { label: "1d", secs: 86400 },
                    { label: "1h", secs: 3600 },
                    { label: "1m", secs: 60 },
                    { label: "1s", secs: 1 },
                  ]}
                  windowStyle="default"
                  onWindowChange={(secs: number) => setSpendWindow(secs)}
                  padding={{ top: 12, right: 60, bottom: 32, left: 12 }}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* Profit */}
          <div className="py-3">
            <div className="px-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Profit
            </div>
            <div className="px-4 space-y-1.5">
              <StatSpendRow label="Total settled" amount={stats.totalSettled} />
              <StatSpendRow label="Today settled" amount={stats.todaySettled} />
              <StatSpendRow label="Payment fees" amount={stats.paymentFees} />
              <StatSpendRow label="Inference cost" amount={stats.inferenceCost} />
              <StatSpendRow label="Profit" amount={stats.totalProfit} />
            </div>
            {profitLive.length > 1 && (
              <div className="mt-2 py-2 h-[200px]">
                <Liveline
                  data={profitLive}
                  value={stats.totalProfit}
                  window={profitWindow}
                  theme="dark"
                  color="#10b981"
                  grid
                  badge={false}
                  fill
                  pulse
                  momentum={false}
                  scrub
                  exaggerate
                  formatValue={(v: number) => `$${v.toFixed(2)}`}
                  formatTime={(t: number) => {
                    const d = new Date(t * 1000);
                    const w = profitWindowRef.current;
                    if (w <= 60) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    if (w <= 86400) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  }}
                  windows={[
                    { label: "1mo", secs: 2592000 },
                    { label: "1w", secs: 604800 },
                    { label: "1d", secs: 86400 },
                    { label: "1h", secs: 3600 },
                    { label: "1m", secs: 60 },
                    { label: "1s", secs: 1 },
                  ]}
                  windowStyle="default"
                  onWindowChange={(secs: number) => setProfitWindow(secs)}
                  padding={{ top: 12, right: 60, bottom: 32, left: 12 }}
                />
              </div>
            )}
          </div>

          <div className="h-px bg-border" />

          {/* Messages */}
          <div className="py-3">
            <div className="px-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground/60 mb-2">
              Messages
            </div>
            <div className="px-4">
              <StatRow label="Total" value={stats.totalMessages.toLocaleString()} />
              <StatRow label="Tokens In" value={(stats.totalTokensIn).toLocaleString()} />
              <StatRow label="Tokens Out" value={(stats.totalTokensOut).toLocaleString()} />
            </div>
            {messagesLive.length > 1 && (
              <div className="mt-2 py-2 h-[200px]">
                <Liveline
                  data={messagesLive}
                  value={stats.totalMessages}
                  window={messagesWindow}
                  theme="dark"
                  color="#3b82f6"
                  grid
                  badge={false}
                  fill
                  pulse
                  momentum={false}
                  scrub
                  exaggerate
                  formatValue={(v: number) => v.toLocaleString()}
                  formatTime={(t: number) => {
                    const d = new Date(t * 1000);
                    const w = messagesWindowRef.current;
                    if (w <= 60) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' });
                    if (w <= 86400) return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
                    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
                  }}
                  windows={[
                    { label: "1mo", secs: 2592000 },
                    { label: "1w", secs: 604800 },
                    { label: "1d", secs: 86400 },
                    { label: "1h", secs: 3600 },
                    { label: "1m", secs: 60 },
                    { label: "1s", secs: 1 },
                  ]}
                  windowStyle="default"
                  onWindowChange={(secs: number) => setMessagesWindow(secs)}
                  padding={{ top: 12, right: 60, bottom: 32, left: 12 }}
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
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [enrichLoading, setEnrichLoading] = useState(false);

  useEffect(() => {
    setEnrichment(null);
    setEnrichLoading(true);
    authFetch(`/api/log/detail?id=${encodeURIComponent(entry.id)}`)
      .then((r) => r.json())
      .then((d) => {
        if (d.enrichment) setEnrichment(d.enrichment);
      })
      .catch(() => {})
      .finally(() => setEnrichLoading(false));
  }, [entry.id]);

  return (
    <div className="px-6 py-5 flex flex-col gap-4">
      {/* Metadata bar */}
      <div className="flex items-center gap-3 font-mono text-[10px] text-muted-foreground/50">
        <span>{formatActor(entry.actor, entry.type)}</span>
        <span>&middot;</span>
        <span>{exactTime(entry.created_at)}</span>
        <span>&middot;</span>
        <span>{relativeTime(entry.created_at)}</span>
      </div>

      {/* ── Commit pushed ─────────────────────────────────── */}
      {entry.type === "commit_pushed" && (
        <div className="flex flex-col gap-3">
          {entry.commit_message && (
            <p className="font-mono text-[13px] text-foreground leading-relaxed whitespace-pre-wrap">
              {entry.commit_message}
            </p>
          )}
          <div className="space-y-1.5">
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
          {!entry.commit_message && (
            <p className="font-mono text-[11px] text-muted-foreground/40 italic">
              commit message not stored (older entry)
            </p>
          )}
        </div>
      )}

      {/* ── Message sent ──────────────────────────────────── */}
      {entry.type === "message_sent" && (
        <div className="flex flex-col gap-3">
          {enrichLoading ? (
            <p className="font-mono text-[11px] text-muted-foreground/40 animate-pulse">loading message...</p>
          ) : enrichment?.userMessage ? (
            <>
              <p className="font-mono text-[13px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
                {enrichment.userMessage.content}
              </p>
              <div className="space-y-1">
                {enrichment.userMessage.model && (
                  <DetailRow label="Model" value={enrichment.userMessage.model} />
                )}
              </div>
            </>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground/40 italic">
              message content not available
            </p>
          )}
        </div>
      )}

      {/* ── Debate started ────────────────────────────────── */}
      {entry.type === "debate_started" && (
        <div className="flex flex-col gap-3">
          {enrichLoading ? (
            <p className="font-mono text-[11px] text-muted-foreground/40 animate-pulse">loading debate...</p>
          ) : enrichment?.debateMessage ? (
            <>
              {/* Debate trace — show each model's turns */}
              {Array.isArray(enrichment.debateMessage.debate_trace) && enrichment.debateMessage.debate_trace.length > 0 ? (
                <div className="flex flex-col gap-3">
                  {enrichment.debateMessage.debate_trace.map((turn, i) => (
                    <div key={i} className="flex flex-col gap-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
                          {turn.model}
                        </span>
                        <span className="font-mono text-[9px] text-muted-foreground/30">
                          {turn.phase}
                        </span>
                      </div>
                      <p className="font-mono text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap break-words">
                        {turn.content}
                      </p>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="font-mono text-[13px] text-foreground leading-relaxed whitespace-pre-wrap break-words">
                  {enrichment.debateMessage.content}
                </p>
              )}
              <div className="h-px bg-border" />
              <div className="space-y-1">
                {enrichment.debateMessage.cost != null && (
                  <DetailRow label="Cost" value={`$${Number(enrichment.debateMessage.cost).toFixed(4)}`} />
                )}
                {(enrichment.debateMessage.tokens_in != null || enrichment.debateMessage.tokens_out != null) && (
                  <DetailRow
                    label="Tokens"
                    value={`${(enrichment.debateMessage.tokens_in ?? 0).toLocaleString()} in / ${(enrichment.debateMessage.tokens_out ?? 0).toLocaleString()} out`}
                  />
                )}
              </div>
            </>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground/40 italic">
              debate content not available
            </p>
          )}
        </div>
      )}

      {/* ── Decision locked ───────────────────────────────── */}
      {entry.type === "decision_locked" && (
        <div className="flex flex-col gap-3">
          {enrichLoading ? (
            <p className="font-mono text-[11px] text-muted-foreground/40 animate-pulse">loading decision...</p>
          ) : enrichment?.decision ? (
            <>
              <p className="font-mono text-[13px] font-medium text-foreground">
                {enrichment.decision.title}
              </p>
              {enrichment.decision.choice && (
                <p className="font-mono text-[12px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
                  {enrichment.decision.choice}
                </p>
              )}
              {enrichment.decision.reasoning && (
                <>
                  <div className="font-mono text-[10px] uppercase tracking-wider text-muted-foreground/50">
                    Reasoning
                  </div>
                  <p className="font-mono text-[11px] text-muted-foreground/70 leading-relaxed whitespace-pre-wrap">
                    {enrichment.decision.reasoning}
                  </p>
                </>
              )}
              {enrichment.decision.category && (
                <DetailRow label="Category" value={enrichment.decision.category} />
              )}
            </>
          ) : (
            <p className="font-mono text-[11px] text-muted-foreground/40 italic">
              decision details not available
            </p>
          )}
        </div>
      )}

      {/* ── Feedback logged ───────────────────────────────── */}
      {entry.type === "feedback_logged" && entry.feedback_text && (
        <p className="font-mono text-[13px] text-foreground/80 leading-relaxed whitespace-pre-wrap">
          {entry.feedback_text}
        </p>
      )}

      {/* ── Path forked / merged ──────────────────────────── */}
      {(entry.type === "path_forked" || entry.type === "path_merged") && (
        <p className="font-mono text-[12px] text-muted-foreground/60">
          {entry.type === "path_forked" ? "Conversation forked into parallel paths" : "Paths merged back together"}
        </p>
      )}

      {/* ── Workspace created ─────────────────────────────── */}
      {entry.type === "workspace_created" && (
        <p className="font-mono text-[12px] text-muted-foreground/60">
          New workspace created
        </p>
      )}

      {/* ── Payment events ──────────────────────────── */}
      {["payment_succeeded", "payment_failed", "auth_hold_created", "refund_issued"].includes(entry.type) && (
        <div className="flex flex-col gap-2">
          {entry.preview && (
            <p className="font-mono text-[13px] text-foreground leading-relaxed">
              {entry.preview}
            </p>
          )}
          <DetailRow label="Source" value="Stripe" />
        </div>
      )}

      {/* ── Fallback for unknown types ────────────────────── */}
      {!["commit_pushed", "message_sent", "debate_started", "decision_locked", "feedback_logged", "path_forked", "path_merged", "workspace_created"].includes(entry.type) && (
        <p className="font-mono text-[12px] text-muted-foreground/60">
          {entry.type}
        </p>
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

  const initialLoadRef = useRef(true);

  const scrollToBottom = useCallback(() => {
    const behavior = initialLoadRef.current ? "instant" as ScrollBehavior : "smooth" as ScrollBehavior;
    feedEndRef.current?.scrollIntoView({ behavior });
    initialLoadRef.current = false;
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
        const res = await authFetch("/api/log?limit=200");
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
      // Instant snap on first load (no delay needed for instant scroll)
      requestAnimationFrame(() => scrollToBottom());
    }
  }, [loading, entries.length, scrollToBottom]);

  // Poll for new entries every 15s
  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const res = await authFetch("/api/log?limit=200");
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
          <AdminConfigButton />
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
            <div className="px-6 py-4 flex flex-col justify-end min-h-full">
              {entries.length === 0 ? (
                <div className="font-mono text-xs text-muted-foreground/40 py-12 text-center mt-auto">
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
            {selectedEntry ? (
              <>
                <h2 className="font-mono text-sm font-semibold text-foreground leading-tight">
                  {getEntryTitle(selectedEntry)}
                </h2>
                <div className="flex items-center gap-2 mt-1.5">
                  <span className={`h-1.5 w-1.5 rounded-full shrink-0 ${EVENT_DOTS[selectedEntry.type] ?? "bg-foreground/20"}`} />
                  <span className="font-mono text-[10px] text-muted-foreground/30">
                    {relativeTime(selectedEntry.created_at)}
                  </span>
                </div>
              </>
            ) : (
              <h2 className="font-mono text-xs font-semibold uppercase tracking-wider text-muted-foreground/40">
                select an event
              </h2>
            )}
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

          {/* Heartbeat — events/sec average */}
          <Heartbeat entries={entries} />
        </div>
      </div>
    </div>
  );
}

// ── Heartbeat ─────────────────────────────────────────────────

function Heartbeat({ entries }: { entries: LogEntry[] }) {
  const [data, setData] = useState<{ time: number; value: number }[]>([]);
  const [currentRate, setCurrentRate] = useState(0);
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  useEffect(() => {
    // Seed with a flat line at 0
    const now = Math.floor(Date.now() / 1000);
    setData([{ time: now - 60, value: 0 }, { time: now, value: 0 }]);

    const prev = { count: entriesRef.current.length, time: Date.now() };

    const interval = setInterval(() => {
      const nowMs = Date.now();
      const nowSec = Math.floor(nowMs / 1000);
      const currentCount = entriesRef.current.length;
      const elapsed = (nowMs - prev.time) / 1000;
      const delta = currentCount - prev.count;

      // Events per second (smoothed over the interval)
      const rate = elapsed > 0 ? Math.max(0, delta / elapsed) : 0;
      prev.count = currentCount;
      prev.time = nowMs;

      setCurrentRate(rate);
      setData((d) => {
        const next = [...d, { time: nowSec, value: Math.round(rate * 1000) / 1000 }];
        // Keep 120 seconds of data
        const cutoff = nowSec - 120;
        return next.filter((p) => p.time >= cutoff);
      });
    }, 1000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="border-t border-border h-[120px] shrink-0 relative">
      <Liveline
        data={data}
        value={currentRate}
        window={120}
        theme="dark"
        color="#10b981"
        grid
        badge
        badgeVariant="minimal"
        fill
        pulse
        momentum={false}
        scrub={false}
        exaggerate
        formatValue={(v: number) => `${v.toFixed(1)} evt/s`}
        padding={{ top: 10, right: 80, bottom: 28, left: 40 }}
      />
    </div>
  );
}

// ── Log Row ──────────────────────────────────────────────────

function LogRow({ entry, selected, onSelect }: { entry: LogEntry; selected: boolean; onSelect: (e: LogEntry) => void }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const actor = formatActor(entry.actor, entry.type);
  const label = EVENT_LABELS[entry.type] ?? entry.type;
  const title = getEntryTitle(entry);
  const dotColor = EVENT_DOTS[entry.type] ?? "bg-foreground/20";
  // Show the richer title when it differs from the generic label
  const showTitle = title !== label;

  return (
    <div
      className={`flex items-center justify-between py-1 group cursor-pointer rounded-sm px-1.5 -mx-1.5 transition-colors ${selected ? "bg-foreground/[0.06]" : "hover:bg-foreground/[0.03]"}`}
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
      onClick={() => onSelect(entry)}
    >
      <div className="flex items-center gap-2 font-mono text-[12px] min-w-0 overflow-hidden">
        <span className={`h-2 w-2 rounded-full shrink-0 ${dotColor}`} />
        <span className="text-muted-foreground/70 shrink-0">{actor}</span>
        <span className="text-foreground/70 shrink-0">{label}</span>
        {showTitle && (
          <span className="text-foreground/40 truncate" title={title}>
            {title}
          </span>
        )}
        {!showTitle && entry.commit_sha && (
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
