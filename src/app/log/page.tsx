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
  category?: string;
  version: number;
  revisitCount: number;
  createdAt: number;
  updatedAt: number;
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

function relativeTime(dateStr: string): string {
  const now = Date.now();
  const then = new Date(dateStr).getTime();
  const diff = now - then;
  const seconds = Math.floor(diff / 1000);
  if (seconds < 60) return "just now";
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} hr ago`;
  const days = Math.floor(hours / 24);
  if (days < 30) return `${days} day${days !== 1 ? "s" : ""} ago`;
  const months = Math.floor(days / 30);
  if (months < 12) return `${months} month${months !== 1 ? "s" : ""} ago`;
  const years = Math.floor(months / 12);
  return `${years} yr${years !== 1 ? "s" : ""} ago`;
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

// ── Main Page ────────────────────────────────────────────────

export default function LogPage() {
  const [entries, setEntries] = useState<LogEntry[]>([]);
  const [decisions, setDecisions] = useState<Decision[]>([]);
  const [loading, setLoading] = useState(true);
  const [darkMode, setDarkMode] = useState(false);
  const [mobileTab, setMobileTab] = useState<"feed" | "decisions">("feed");
  const feedEndRef = useRef<HTMLDivElement>(null);
  const feedContainerRef = useRef<HTMLDivElement>(null);
  const [isAtBottom, setIsAtBottom] = useState(true);

  const scrollToBottom = useCallback(() => {
    feedEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, []);

  // Check if user is scrolled to bottom
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

  // Auto-scroll on initial load
  useEffect(() => {
    if (!loading && entries.length > 0) {
      // Wait for render
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
            // Auto-scroll only if user was at bottom
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

  // ── Theme classes ──────────────────────────────────────────
  const feedBg = darkMode ? "bg-[#0a0a0a] text-neutral-300" : "bg-[#fafaf9] text-neutral-800";
  const panelBg = darkMode ? "bg-[#fafaf9] text-neutral-800" : "bg-[#0a0a0a] text-neutral-300";
  const feedBorder = darkMode ? "border-neutral-800" : "border-neutral-200";
  const panelBorder = darkMode ? "border-neutral-200" : "border-neutral-800";
  const feedMuted = darkMode ? "text-neutral-600" : "text-neutral-400";
  const panelMuted = darkMode ? "text-neutral-400" : "text-neutral-600";

  if (loading) {
    return (
      <div className="h-screen flex items-center justify-center bg-[#fafaf9] font-mono text-xs text-neutral-400">
        loading...
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col font-mono overflow-hidden">
      {/* Header */}
      <header className={`flex items-center justify-between px-6 py-3 border-b ${feedBg} ${feedBorder}`}>
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold tracking-tight">meter.log</span>
          <span className={`text-[10px] ${feedMuted}`}>live development feed</span>
        </div>
        <div className="flex items-center gap-3">
          {/* Mobile tab switcher */}
          {isMobile && (
            <div className="flex gap-1">
              <button
                onClick={() => setMobileTab("feed")}
                className={`px-2 py-1 text-[10px] rounded ${mobileTab === "feed" ? "bg-foreground/10" : ""}`}
              >
                feed
              </button>
              <button
                onClick={() => setMobileTab("decisions")}
                className={`px-2 py-1 text-[10px] rounded ${mobileTab === "decisions" ? "bg-foreground/10" : ""}`}
              >
                decisions
              </button>
            </div>
          )}
          {/* Theme toggle */}
          <button
            onClick={() => setDarkMode(!darkMode)}
            className={`p-1.5 rounded-md transition-colors ${feedMuted} hover:opacity-70`}
            title="Toggle theme"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              {darkMode ? (
                <><circle cx="12" cy="12" r="5" /><line x1="12" y1="1" x2="12" y2="3" /><line x1="12" y1="21" x2="12" y2="23" /><line x1="4.22" y1="4.22" x2="5.64" y2="5.64" /><line x1="18.36" y1="18.36" x2="19.78" y2="19.78" /><line x1="1" y1="12" x2="3" y2="12" /><line x1="21" y1="12" x2="23" y2="12" /><line x1="4.22" y1="19.78" x2="5.64" y2="18.36" /><line x1="18.36" y1="5.64" x2="19.78" y2="4.22" /></>
              ) : (
                <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
              )}
            </svg>
          </button>
        </div>
      </header>

      {/* Main content */}
      <div className="flex-1 flex overflow-hidden">
        {/* Left: Feed (60%) */}
        <div
          className={`${isMobile && mobileTab !== "feed" ? "hidden" : ""} ${isMobile ? "w-full" : "w-[60%]"} flex flex-col ${feedBg}`}
        >
          <div
            ref={feedContainerRef}
            onScroll={handleScroll}
            className="flex-1 overflow-y-auto"
          >
            <div className="px-6 py-4 flex flex-col">
              {entries.length === 0 ? (
                <div className={`text-xs ${feedMuted} py-12 text-center`}>
                  no activity yet
                </div>
              ) : (
                entries.map((entry) => (
                  <LogRow
                    key={entry.id}
                    entry={entry}
                    muted={feedMuted}
                  />
                ))
              )}
              <div ref={feedEndRef} />
            </div>
          </div>

          {/* Scroll to bottom button */}
          {!isAtBottom && entries.length > 0 && (
            <button
              onClick={scrollToBottom}
              className={`absolute bottom-4 left-[30%] -translate-x-1/2 px-3 py-1.5 rounded-full text-[10px] border ${feedBorder} ${feedBg} shadow-lg hover:opacity-80 transition-opacity`}
            >
              ↓ latest
            </button>
          )}
        </div>

        {/* Right: Decisions panel (40%) */}
        <div
          className={`${isMobile && mobileTab !== "decisions" ? "hidden" : ""} ${isMobile ? "w-full" : "w-[40%]"} flex flex-col border-l ${panelBorder} ${panelBg}`}
        >
          <div className={`px-6 py-4 border-b ${panelBorder}`}>
            <h2 className="text-xs font-semibold uppercase tracking-wider">Meter Decisions</h2>
            <p className={`text-[10px] ${panelMuted} mt-0.5`}>
              {decisions.length} locked decision{decisions.length !== 1 ? "s" : ""}
            </p>
          </div>

          <div className="flex-1 overflow-y-auto px-6 py-4 flex flex-col gap-3">
            {decisions.length === 0 ? (
              <div className={`text-xs ${panelMuted} py-12 text-center`}>
                no decisions yet
              </div>
            ) : (
              decisions.map((d) => (
                <DecisionCard
                  key={d.id}
                  decision={d}
                  muted={panelMuted}
                  border={panelBorder}
                />
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Log Row ──────────────────────────────────────────────────

function LogRow({ entry, muted }: { entry: LogEntry; muted: string }) {
  const [showTooltip, setShowTooltip] = useState(false);
  const actor = formatActor(entry.actor, entry.type);
  const action = EVENT_LABELS[entry.type] ?? entry.type;

  return (
    <div
      className="flex items-baseline justify-between py-[3px] group"
      onMouseEnter={() => setShowTooltip(true)}
      onMouseLeave={() => setShowTooltip(false)}
    >
      <div className="flex items-baseline gap-0 text-[12px] min-w-0">
        <span className={`${muted} shrink-0`}>{actor}</span>
        <span className="mx-1.5 opacity-60">{action}</span>
        {entry.commit_sha && (
          <span className={`${muted} text-[10px]`}>
            {entry.commit_url ? (
              <a
                href={entry.commit_url}
                target="_blank"
                rel="noopener noreferrer"
                className="hover:underline"
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
        <span className={`text-[10px] ${muted}`}>
          {relativeTime(entry.created_at)}
        </span>
        {showTooltip && (
          <div className="absolute bottom-full right-0 mb-1 px-2 py-1 rounded bg-neutral-900 text-neutral-100 text-[10px] whitespace-nowrap z-10 shadow-lg">
            {exactTime(entry.created_at)}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Decision Card ────────────────────────────────────────────

function DecisionCard({
  decision,
  muted,
  border,
}: {
  decision: Decision;
  muted: string;
  border: string;
}) {
  return (
    <div className={`rounded-lg border ${border} p-3 flex flex-col gap-1.5`}>
      <div className="flex items-start justify-between gap-2">
        <span className="text-[12px] font-medium leading-tight">{decision.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {decision.category && (
            <span className={`text-[9px] uppercase tracking-wider px-1.5 py-0.5 rounded border ${border} ${muted}`}>
              {decision.category}
            </span>
          )}
          {decision.version > 1 && (
            <span className={`text-[9px] ${muted}`}>v{decision.version}</span>
          )}
        </div>
      </div>
      {decision.choice && (
        <p className={`text-[11px] ${muted} leading-relaxed`}>{decision.choice}</p>
      )}
      <span className={`text-[9px] ${muted}`}>
        {relativeTime(new Date(decision.updatedAt).toISOString())}
      </span>
    </div>
  );
}
