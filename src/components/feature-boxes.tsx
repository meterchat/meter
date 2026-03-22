"use client";

import { useState, useEffect, useRef } from "react";
import { motion, useInView } from "framer-motion";
import dynamic from "next/dynamic";
import { MeterIcon } from "./meter-icon";

const Liveline = dynamic(() => import("liveline").then((m) => m.Liveline), {
  ssr: false,
  loading: () => <div className="h-[28px]" />,
});

// ── Infinity path (reused from sync-button) ─────────────────────────
const INFINITY_PATH =
  "M18.178 8c5.096 0 5.096 8 0 8-5.095 0-7.133-8-12.739-8-4.585 0-4.585 8 0 8 5.606 0 7.644-8 12.74-8z";

// ── Slash command data (subset from connectors.ts) ──────────────────
const STRATEGY_COMMANDS = [
  { cmd: "/invert", desc: "Flip your assumption", icon: "M21 12a9 9 0 1 1-9-9 M21 3v9h-9" },
  { cmd: "/score", desc: "Score this idea out of 100", icon: "M12 2l3.09 6.26L22 9.27l-5 4.87 1.18 6.88L12 17.77l-6.18 3.25L7 14.14 2 9.27l6.91-1.01L12 2z" },
  { cmd: "/dissect", desc: "Break it down systematically", icon: "M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" },
  { cmd: "/steelman", desc: "Make the strongest case", icon: "M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" },
  { cmd: "/blueprint", desc: "Generate full spec files", icon: "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z" },
];

// ── FeatureBox wrapper ──────────────────────────────────────────────
function FeatureBox({
  title,
  description,
  children,
  colSpan = 1,
}: {
  title: string;
  description: string;
  children: (hovered: boolean) => React.ReactNode;
  colSpan?: number;
}) {
  const [isHovered, setIsHovered] = useState(false);

  return (
    <div
      className={`relative flex flex-col border-foreground/[0.06] px-6 xl:px-8 pt-6 pb-8 transition-colors duration-300 hover:bg-foreground/[0.02] ${
        colSpan === 2 ? "col-span-1 md:col-span-2" : "col-span-1"
      }`}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
    >
      {/* Animation area */}
      <div
        className={`h-[140px] flex items-center justify-center mb-5 transition-all duration-500 ${
          isHovered ? "grayscale-0 opacity-100" : "grayscale opacity-50"
        }`}
      >
        {children(isHovered)}
      </div>

      {/* Title */}
      <h3
        className={`text-[15px] font-semibold tracking-tight mb-1.5 transition-colors duration-300 ${
          isHovered ? "text-foreground" : "text-foreground/70"
        }`}
      >
        {title}
      </h3>

      {/* Description */}
      <p className="text-[13px] text-muted-foreground/50 leading-relaxed">
        {description}
      </p>
    </div>
  );
}

// ── Mini Animations ─────────────────────────────────────────────────

// 1. Fork & Merge (compact)
function BoxForkMerge({ active }: { active: boolean }) {
  const [phase, setPhase] = useState(0);

  useEffect(() => {
    if (!active) {
      setPhase(0);
      return;
    }
    setPhase(1);
    const t1 = setTimeout(() => setPhase(2), 600);
    const t2 = setTimeout(() => setPhase(3), 1200);
    const t3 = setTimeout(() => setPhase(4), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [active]);

  return (
    <div className="w-full max-w-[220px]">
      <div className="rounded-lg border border-foreground/[0.06] bg-background/50 overflow-hidden">
        {/* Main thread */}
        <div className="px-3 py-2 border-b border-foreground/[0.04]">
          <div className="text-[10px] text-muted-foreground/40 truncate">
            What framework for the dashboard?
          </div>
        </div>

        {/* Fork indicator */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 transition-opacity duration-400 ${
            phase >= 1 ? "opacity-100" : "opacity-0"
          }`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-teal-400/60"
          >
            <line x1="6" y1="3" x2="6" y2="15" />
            <circle cx="18" cy="6" r="3" />
            <circle cx="6" cy="18" r="3" />
            <path d="M18 9a9 9 0 0 1-9 9" />
          </svg>
          <span className="font-mono text-[9px] text-teal-400/60">Forked</span>
        </div>

        {/* Paths */}
        <div className="px-3 pb-2 space-y-1">
          <div
            className={`flex items-center gap-1.5 rounded px-2 py-1 transition-all duration-400 ${
              phase >= 2 ? "bg-teal-500/10 border border-teal-500/20 opacity-100" : "opacity-0"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-teal-500" />
            <span className="font-mono text-[9px] text-teal-400">Next.js + tRPC</span>
          </div>
          <div
            className={`flex items-center gap-1.5 rounded px-2 py-1 transition-all duration-400 ${
              phase >= 2 ? "bg-indigo-500/10 border border-indigo-500/20 opacity-100" : "opacity-0"
            }`}
          >
            <span className="h-1.5 w-1.5 rounded-full bg-indigo-500" />
            <span className="font-mono text-[9px] text-indigo-400">Remix + GraphQL</span>
          </div>
        </div>

        {/* Merge indicator */}
        <div
          className={`flex items-center gap-2 px-3 py-1.5 border-t border-foreground/[0.04] transition-opacity duration-400 ${
            phase >= 3 ? "opacity-100" : "opacity-0"
          }`}
        >
          <svg
            width="10"
            height="10"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className={`transition-colors duration-300 ${
              phase >= 4 ? "text-emerald-500/60" : "text-muted-foreground/40"
            }`}
          >
            <circle cx="12" cy="18" r="3" />
            <circle cx="6" cy="6" r="3" />
            <circle cx="18" cy="6" r="3" />
            <path d="M6 9v3a6 6 0 0 0 6 6" />
            <path d="M18 9v3a6 6 0 0 1-6 6" />
          </svg>
          <span
            className={`font-mono text-[9px] transition-colors duration-300 ${
              phase >= 4 ? "text-emerald-500/60" : "text-muted-foreground/40"
            }`}
          >
            {phase >= 4 ? "Merged" : "Merging..."}
          </span>
        </div>
      </div>
    </div>
  );
}

// 2. Agent Spec Kit (compact, wider)
function BoxSpecKit({ active }: { active: boolean }) {
  const [progress, setProgress] = useState(0);
  const files = ["README.md", "ARCHITECTURE.md", "DESIGN.md", "DECISIONS.md", "CLAUDE.md"];

  useEffect(() => {
    if (!active) {
      setProgress(0);
      return;
    }
    let step = 0;
    const interval = setInterval(() => {
      step++;
      if (step <= files.length) {
        setProgress(step);
      } else if (step > files.length + 2) {
        step = 0;
        setProgress(0);
      }
    }, 400);
    return () => clearInterval(interval);
  }, [active, files.length]);

  return (
    <div className="w-full max-w-[320px]">
      <div className="rounded-lg border border-foreground/[0.06] bg-background/50 overflow-hidden">
        <div className="px-3 py-2 border-b border-foreground/[0.04] flex items-center justify-between">
          <span className="font-mono text-[10px] text-foreground/60">Agent Spec Kit</span>
          <span
            className={`font-mono text-[9px] transition-colors duration-300 ${
              progress >= files.length ? "text-emerald-500/60" : "text-muted-foreground/30"
            }`}
          >
            {progress >= files.length ? "Ready" : "Generating..."}
          </span>
        </div>
        <div className="p-2 space-y-0.5">
          {files.map((file, i) => {
            const done = i < progress;
            return (
              <div
                key={file}
                className={`flex items-center gap-1.5 px-2 py-1 rounded transition-colors duration-200 ${
                  done ? "bg-foreground/[0.03]" : ""
                }`}
              >
                <span
                  className={`text-[9px] transition-colors duration-200 ${
                    done ? "text-emerald-500/60" : "text-muted-foreground/20"
                  }`}
                >
                  {done ? "✓" : "○"}
                </span>
                <span
                  className={`font-mono text-[10px] transition-colors duration-200 ${
                    done ? "text-foreground/60" : "text-muted-foreground/25"
                  }`}
                >
                  {file}
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// 3. Strategy Slash Commands
function BoxSlashCommands({ active }: { active: boolean }) {
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (!active) {
      setActiveIdx(-1);
      return;
    }
    let idx = 0;
    setActiveIdx(0);
    const interval = setInterval(() => {
      idx = (idx + 1) % STRATEGY_COMMANDS.length;
      setActiveIdx(idx);
    }, 700);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <div className="w-full max-w-[180px]">
      <div className="rounded-lg border border-foreground/[0.06] bg-background/50 overflow-hidden">
        <div className="p-1.5 space-y-0.5">
          {STRATEGY_COMMANDS.map((cmd, i) => (
            <div
              key={cmd.cmd}
              className={`flex items-center gap-2 rounded px-2 py-1.5 transition-all duration-200 ${
                i === activeIdx
                  ? "bg-foreground/[0.06]"
                  : ""
              }`}
            >
              <svg
                width="11"
                height="11"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
                className={`shrink-0 transition-colors duration-200 ${
                  i === activeIdx ? "text-foreground/60" : "text-muted-foreground/25"
                }`}
              >
                <path d={cmd.icon} />
              </svg>
              <span
                className={`font-mono text-[10px] transition-colors duration-200 ${
                  i === activeIdx ? "text-foreground/70" : "text-muted-foreground/30"
                }`}
              >
                {cmd.cmd}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// 4. Privacy & Passkey (compact)
function BoxPrivacy({ active }: { active: boolean }) {
  const [phase, setPhase] = useState<"idle" | "verifying" | "verified">("idle");

  useEffect(() => {
    if (!active) {
      setPhase("idle");
      return;
    }
    setPhase("verifying");
    const t1 = setTimeout(() => setPhase("verified"), 1200);
    return () => clearTimeout(t1);
  }, [active]);

  return (
    <div className="flex flex-col items-center gap-3">
      <motion.div
        className={`flex items-center justify-center w-12 h-12 rounded-xl border transition-colors duration-500 ${
          phase === "verified"
            ? "border-emerald-500/20 bg-emerald-500/5"
            : phase === "verifying"
              ? "border-amber-500/20 bg-amber-500/5"
              : "border-foreground/[0.06] bg-foreground/[0.02]"
        }`}
        animate={phase === "verifying" ? { scale: [1, 1.05, 1] } : { scale: 1 }}
        transition={{ duration: 1, repeat: phase === "verifying" ? Infinity : 0 }}
      >
        <svg
          width="20"
          height="20"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`transition-colors duration-500 ${
            phase === "verified"
              ? "text-emerald-500/70"
              : phase === "verifying"
                ? "text-amber-500/70"
                : "text-foreground/30"
          }`}
        >
          {phase === "verified" ? (
            <path d="M20 6L9 17l-5-5" />
          ) : (
            <>
              <path d="M2 18v3c0 .6.4 1 1 1h4v-3h3v-3h2l1.4-1.4a6.5 6.5 0 1 0-4-4Z" />
              <circle cx="16.5" cy="7.5" r=".5" fill="currentColor" />
            </>
          )}
        </svg>
      </motion.div>
      <div className="flex items-center gap-2">
        <span
          className={`font-mono text-[10px] px-2 py-0.5 rounded-full transition-colors duration-300 ${
            phase === "verified"
              ? "bg-emerald-500/10 text-emerald-500/70"
              : phase === "verifying"
                ? "bg-amber-500/10 text-amber-500/70"
                : "bg-foreground/[0.04] text-muted-foreground/40"
          }`}
        >
          {phase === "verified" ? "Verified" : phase === "verifying" ? "Verifying..." : "Passkey"}
        </span>
      </div>
      <div className="font-mono text-[9px] text-muted-foreground/30">
        {phase === "verified" ? "usr_a8f3k2m9x1" : "No email. No password."}
      </div>
    </div>
  );
}

// 5. Caps & Limits
function BoxCapsLimits({ active }: { active: boolean }) {
  const [fill, setFill] = useState(0);

  useEffect(() => {
    if (!active) {
      setFill(0);
      return;
    }
    let progress = 0;
    const interval = setInterval(() => {
      progress += 3;
      if (progress > 100) progress = 0;
      setFill(progress);
    }, 50);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <div className="w-full max-w-[180px] space-y-3">
      {/* Daily limit */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[9px] text-muted-foreground/40 uppercase tracking-wider">
            Daily limit
          </span>
          <span className="font-mono text-[10px] text-foreground/50">
            ${((fill / 100) * 5).toFixed(2)} / $5.00
          </span>
        </div>
        <div className="h-1.5 rounded-full bg-foreground/[0.04] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-100 ${
              fill > 80 ? "bg-amber-500/60" : "bg-foreground/20"
            }`}
            style={{ width: `${Math.min(fill, 100)}%` }}
          />
        </div>
      </div>

      {/* Per-message cap */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <span className="font-mono text-[9px] text-muted-foreground/40 uppercase tracking-wider">
            Per-message cap
          </span>
          <span className="font-mono text-[10px] text-foreground/50">$0.50</span>
        </div>
        <div className="h-1.5 rounded-full bg-foreground/[0.04] overflow-hidden">
          <div
            className="h-full rounded-full bg-foreground/15"
            style={{ width: `${Math.min(fill * 0.6, 60)}%` }}
          />
        </div>
      </div>

      {/* Toggle */}
      <div className="flex items-center justify-between">
        <span className="font-mono text-[9px] text-muted-foreground/40">Auto-pause</span>
        <div
          className={`w-7 h-4 rounded-full transition-colors duration-300 flex items-center ${
            active ? "bg-emerald-500/40 justify-end" : "bg-foreground/10 justify-start"
          }`}
        >
          <div className="w-3 h-3 rounded-full bg-foreground/60 mx-0.5" />
        </div>
      </div>
    </div>
  );
}

// 6. Track Usage & Spend (with real Liveline)
function BoxTrackUsage({ active }: { active: boolean }) {
  const [counters, setCounters] = useState({ today: 0, week: 0, messages: 0 });
  const [data, setData] = useState<{ time: number; value: number }[]>([]);
  const [currentValue, setCurrentValue] = useState(0);

  // Counter animation
  useEffect(() => {
    if (!active) {
      setCounters({ today: 0, week: 0, messages: 0 });
      return;
    }
    let step = 0;
    const interval = setInterval(() => {
      step++;
      const t = Math.min(step / 20, 1);
      setCounters({
        today: +(t * 1.23).toFixed(2),
        week: +(t * 8.45).toFixed(2),
        messages: Math.round(t * 47),
      });
    }, 60);
    return () => clearInterval(interval);
  }, [active]);

  // Liveline data feed
  useEffect(() => {
    if (!active) {
      setData([]);
      setCurrentValue(0);
      return;
    }
    const now = Math.floor(Date.now() / 1000);
    setData([
      { time: now - 5, value: 0 },
      { time: now, value: 0 },
    ]);

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const spend =
        Math.random() > 0.3
          ? +(Math.random() * 0.08 + 0.01).toFixed(3)
          : +(Math.random() * 0.005).toFixed(3);
      setCurrentValue(spend);
      setData((d) => {
        const next = [...d, { time: nowSec, value: spend }];
        return next.filter((p) => p.time >= nowSec - 30);
      });
    }, 500);
    return () => clearInterval(interval);
  }, [active]);

  return (
    <div className="w-full max-w-[200px]">
      <div className="rounded-lg border border-foreground/[0.06] bg-background/50 overflow-hidden">
        <div className="px-3 py-2 border-b border-foreground/[0.04] flex items-center gap-1.5">
          <MeterIcon active={false} size={10} />
          <span className="font-mono text-[10px] text-foreground/60">Usage</span>
        </div>
        <div className="p-3 space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/40">Today</span>
            <span className="font-mono text-[11px] text-foreground/60 tabular-nums">
              ${counters.today.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/40">This week</span>
            <span className="font-mono text-[11px] text-foreground/60 tabular-nums">
              ${counters.week.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[10px] text-muted-foreground/40">Messages</span>
            <span className="font-mono text-[11px] text-foreground/60 tabular-nums">
              {counters.messages}
            </span>
          </div>
          {/* Real Liveline chart */}
          <div className="h-[28px]">
            {data.length > 0 && (
              <Liveline
                data={data}
                value={currentValue}
                window={30}
                theme="dark"
                color="#f59e0b"
                fill
                pulse
                exaggerate
                momentum={false}
                scrub={false}
                grid={false}
                badge={false}
                padding={{ top: 0, right: 4, bottom: 0, left: 4 }}
                className="!bg-transparent !border-none"
                style={{ border: "none" }}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// 7. Strategy Sync (with infinity icon)
function BoxStrategySync({ active }: { active: boolean }) {
  const [findings, setFindings] = useState<string[]>([]);

  useEffect(() => {
    if (!active) {
      setFindings([]);
      return;
    }
    const t1 = setTimeout(() => setFindings(["contradiction"]), 500);
    const t2 = setTimeout(() => setFindings(["contradiction", "gap"]), 1000);
    const t3 = setTimeout(() => setFindings(["contradiction", "gap", "stale"]), 1500);
    return () => { clearTimeout(t1); clearTimeout(t2); clearTimeout(t3); };
  }, [active]);

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-[240px]">
      {/* Infinity icon */}
      <svg
        width="40"
        height="40"
        viewBox="0 0 24 24"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d={INFINITY_PATH} stroke="currentColor" className="text-foreground/10" />
        {active && (
          <path
            d={INFINITY_PATH}
            stroke="#f59e0b"
            className="sync-fill"
            strokeOpacity="0.8"
          />
        )}
      </svg>

      {/* Finding badges */}
      <div className="flex flex-wrap justify-center gap-1.5">
        {findings.map((f) => (
          <span
            key={f}
            className={`font-mono text-[9px] px-2 py-0.5 rounded-full border transition-all duration-300 ${
              f === "contradiction"
                ? "border-red-500/20 bg-red-500/5 text-red-400/70"
                : f === "gap"
                  ? "border-amber-500/20 bg-amber-500/5 text-amber-400/70"
                  : "border-blue-500/20 bg-blue-500/5 text-blue-400/70"
            }`}
          >
            {f}
          </span>
        ))}
        {findings.length === 0 && (
          <span className="font-mono text-[9px] text-muted-foreground/25">
            Scanning decisions...
          </span>
        )}
      </div>
    </div>
  );
}

// 8. MCP Connect
function BoxMCPConnect({ active }: { active: boolean }) {
  const [connected, setConnected] = useState<number[]>([]);
  const tools = [
    { name: "Claude Code", x: 15, y: 20 },
    { name: "Cursor", x: 85, y: 20 },
    { name: "Windsurf", x: 15, y: 80 },
    { name: "VS Code", x: 85, y: 80 },
  ];

  useEffect(() => {
    if (!active) {
      setConnected([]);
      return;
    }
    const timers = tools.map((_, i) =>
      setTimeout(() => setConnected((c) => [...c, i]), 300 + i * 350)
    );
    return () => timers.forEach(clearTimeout);
  }, [active]);

  return (
    <div className="w-full max-w-[260px]">
      <div className="relative h-[120px]">
        {/* Center - Meter icon */}
        <div className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-10 flex items-center justify-center w-10 h-10 rounded-xl border border-foreground/[0.08] bg-background">
          <MeterIcon active={false} size={18} />
        </div>

        {/* Connection lines + tool nodes */}
        <svg className="absolute inset-0 w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
          {tools.map((tool, i) => (
            <line
              key={i}
              x1="50"
              y1="50"
              x2={tool.x}
              y2={tool.y}
              stroke="currentColor"
              strokeWidth="0.5"
              className={`transition-all duration-500 ${
                connected.includes(i) ? "text-emerald-500/40" : "text-foreground/[0.04]"
              }`}
              strokeDasharray={connected.includes(i) ? "none" : "2 2"}
            />
          ))}
        </svg>

        {/* Tool labels */}
        {tools.map((tool, i) => (
          <div
            key={tool.name}
            className={`absolute transition-all duration-400 ${
              connected.includes(i) ? "opacity-100" : "opacity-30"
            }`}
            style={{
              left: `${tool.x}%`,
              top: `${tool.y}%`,
              transform: "translate(-50%, -50%)",
            }}
          >
            <div
              className={`flex items-center gap-1 px-2 py-1 rounded-md border transition-colors duration-300 ${
                connected.includes(i)
                  ? "border-emerald-500/20 bg-emerald-500/5"
                  : "border-foreground/[0.06] bg-background/50"
              }`}
            >
              <span
                className={`h-1.5 w-1.5 rounded-full transition-colors duration-300 ${
                  connected.includes(i) ? "bg-emerald-500" : "bg-foreground/20"
                }`}
              />
              <span className="font-mono text-[8px] text-foreground/50 whitespace-nowrap">
                {tool.name}
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Feature Boxes Grid ──────────────────────────────────────────────
export function FeatureBoxGrid() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.section
      ref={ref}
      className="relative z-10 py-16 sm:py-24 px-6"
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.8, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="max-w-5xl mx-auto">
        {/* Section header */}
        <div className="text-center mb-10">
          <span className="inline-flex items-center px-3 py-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.03] font-mono text-[11px] tracking-[0.15em] text-muted-foreground/60 uppercase">
            Built for serious work
          </span>
        </div>

        {/* Grid container with outer border */}
        <div className="rounded-2xl border border-foreground/[0.06] bg-[#1e1e1e] overflow-hidden">
          {/* Row 1: Fork & Merge | Agent Spec Kit (2 cols) | Slash Commands */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4">
            <div className="border-b border-foreground/[0.06] md:border-r">
              <FeatureBox
                title="Fork & Merge"
                description="Explore competing approaches in parallel. Commit to one when ready."
              >
                {(h) => <BoxForkMerge active={h} />}
              </FeatureBox>
            </div>
            <div className="border-b border-foreground/[0.06] lg:col-span-2 lg:border-r">
              <FeatureBox
                title="Agent Spec Kit"
                description="Turn decisions into structured specs — README, ARCHITECTURE, DESIGN, DECISIONS, CLAUDE.md. Feed them to your coding agents via MCP."
                colSpan={2}
              >
                {(h) => <BoxSpecKit active={h} />}
              </FeatureBox>
            </div>
            <div className="border-b border-foreground/[0.06] md:border-r lg:border-r-0">
              <FeatureBox
                title="Strategy Commands"
                description="Built-in slash commands for strategic thinking."
              >
                {(h) => <BoxSlashCommands active={h} />}
              </FeatureBox>
            </div>
          </div>

          {/* Row 2: Strategy Sync | Caps & Limits | Track Usage */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3">
            <div className="border-b border-foreground/[0.06] md:border-r">
              <FeatureBox
                title="Strategy Sync"
                description="Cross-check your decisions for contradictions, gaps, and stale reasoning."
              >
                {(h) => <BoxStrategySync active={h} />}
              </FeatureBox>
            </div>
            <div className="border-b border-foreground/[0.06] lg:border-r">
              <FeatureBox
                title="Caps & Limits"
                description="Set daily spend limits and per-message caps. Auto-pause when you hit them."
              >
                {(h) => <BoxCapsLimits active={h} />}
              </FeatureBox>
            </div>
            <div className="border-b border-foreground/[0.06] md:border-r lg:border-r-0">
              <FeatureBox
                title="Track Usage"
                description="Real-time spend tracking. See exactly where every cent goes."
              >
                {(h) => <BoxTrackUsage active={h} />}
              </FeatureBox>
            </div>
          </div>

          {/* Row 3: Private by Default (2 cols) | MCP Connect (2 cols) */}
          <div className="grid grid-cols-1 md:grid-cols-2">
            <div className="border-b md:border-b-0 md:border-r border-foreground/[0.06]">
              <FeatureBox
                title="Private by Default"
                description="Passkey-only auth. No email, no password, no tracking. Your identity is a random ID — we never see your name."
                colSpan={2}
              >
                {(h) => <BoxPrivacy active={h} />}
              </FeatureBox>
            </div>
            <div>
              <FeatureBox
                title="MCP Connect"
                description="Connect Meter to your coding agents. Claude Code, Cursor, Windsurf, VS Code — decisions flow directly into your workflow."
                colSpan={2}
              >
                {(h) => <BoxMCPConnect active={h} />}
              </FeatureBox>
            </div>
          </div>
        </div>
      </div>
    </motion.section>
  );
}
