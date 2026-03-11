"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import { useMeterStore } from "@/lib/store";
import { apiUrl } from "@/lib/api-url";
import {
  identifyUser,
  trackAccountCreated,
  trackUserLoggedIn,
  trackLoginFailed,
  trackCrossDeviceAuthStarted,
} from "@/lib/analytics";
import {
  startRegistration,
  base64URLStringToBuffer,
  bufferToBase64URLString,
} from "@simplewebauthn/browser";
import { getModel, shortModelName, MODELS, DEBATE_MODELS } from "@/lib/models";
import { MeterIcon } from "./meter-icon";
import { ProviderLogo, ModelLogo } from "./model-picker";

// ── Types ──────────────────────────────────────────────────────────────

type AuthStep = "passkey" | "no-account";

interface PendingUser {
  id: string;
  handle: string | null;
  email: string | null;
  cardOnFile: boolean;
  cardLast4: string | null;
  cardBrand?: string;
  gmailConnected: boolean;
  accountType?: string;
  markupMultiplier?: number;
  hasWorkspaces?: boolean;
}

// ── Helpers ────────────────────────────────────────────────────────────

function credentialToJSON(cred: PublicKeyCredential) {
  const response = cred.response as AuthenticatorAssertionResponse;
  return {
    id: cred.id,
    rawId: bufferToBase64URLString(cred.rawId),
    response: {
      clientDataJSON: bufferToBase64URLString(response.clientDataJSON),
      authenticatorData: bufferToBase64URLString(response.authenticatorData),
      signature: bufferToBase64URLString(response.signature),
      ...(response.userHandle
        ? { userHandle: bufferToBase64URLString(response.userHandle) }
        : {}),
    },
    authenticatorAttachment: cred.authenticatorAttachment ?? undefined,
    clientExtensionResults: cred.getClientExtensionResults(),
    type: cred.type,
  };
}

// ── App-style UI Animation Components ─────────────────────────────────

// Animated brainwave / meter pulse below hero
function MeterPulse() {
  const [offset, setOffset] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false });

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setOffset((o) => o + 1);
    }, 80);
    return () => clearInterval(interval);
  }, [isInView]);

  // Generate a wave pattern that scrolls
  const width = 80;
  const wave = useMemo(() => {
    const chars = " ▁▂▃▄▅▆▇█▇▆▅▄▃▂▁";
    const result: string[] = [];
    for (let i = 0; i < width; i++) {
      const idx = Math.floor(
        (Math.sin((i + offset) * 0.15) * 0.5 + 0.5) *
          (chars.length - 1) +
          Math.sin((i + offset) * 0.08 + 2) * 2
      );
      result.push(chars[Math.max(0, Math.min(chars.length - 1, idx))]);
    }
    return result.join("");
  }, [offset]);

  return (
    <div ref={ref} className="w-full overflow-hidden py-8">
      <div className="font-mono text-[11px] text-foreground/[0.06] whitespace-pre text-center select-none tracking-widest">
        {wave}
      </div>
    </div>
  );
}

// Mini MeterPill-style cost ticker for landing page
function LiveMeterPill() {
  const [cost, setCost] = useState(0);
  const [phase, setPhase] = useState<"idle" | "streaming" | "settled">("idle");
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });
  const intervalRef = useRef<ReturnType<typeof setInterval>>(undefined);

  useEffect(() => {
    if (!isInView) {
      setPhase("idle");
      setCost(0);
      return;
    }
    // Cycle: idle → streaming → settled → idle
    let step = 0;
    const maxCost = 0.0153;
    setPhase("streaming");
    setCost(0);

    intervalRef.current = setInterval(() => {
      step++;
      if (step < 30) {
        // streaming phase
        setCost((c) => Math.min(c + maxCost / 30 + Math.random() * 0.0003, maxCost));
      } else if (step === 30) {
        setPhase("settled");
        setCost(maxCost);
      } else if (step === 40) {
        // restart
        step = 0;
        setPhase("streaming");
        setCost(0);
      }
    }, 150);

    return () => clearInterval(intervalRef.current);
  }, [isInView]);

  const formatted = cost.toFixed(4);

  return (
    <div ref={ref} className="flex flex-col items-center gap-4">
      {/* Mini chat UI showing a response being metered */}
      <div className="w-full max-w-[320px] rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        {/* Model bar */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/[0.04]">
          <ProviderLogo provider="Anthropic" size={11} />
          <span className="font-mono text-[10px] text-muted-foreground/60">Sonnet 4.6</span>
          <span className="font-mono text-[10px] text-muted-foreground/30 ml-auto">Anthropic</span>
        </div>

        {/* Chat content */}
        <div className="p-3 space-y-2">
          <div className="text-[12px] text-muted-foreground/40">
            What stack should we use for the new dashboard?
          </div>
          <div className="text-[12px] text-foreground/70 leading-relaxed">
            Based on your requirements for real-time data and team familiarity, I&apos;d recommend Next.js with...
            {phase === "streaming" && (
              <span className="inline-block w-1.5 h-3 bg-[#D97757]/50 ml-0.5 animate-pulse" />
            )}
          </div>
        </div>

        {/* Meter pill footer */}
        <div className="flex items-center gap-2 px-3 py-2 border-t border-foreground/[0.04]">
          <MeterIcon active={phase === "streaming"} size={14} />
          <span
            className={`font-mono text-[11px] tabular-nums transition-colors duration-300 ${
              phase === "settled"
                ? "text-muted-foreground/40"
                : phase === "streaming"
                  ? "text-foreground"
                  : "text-muted-foreground/30"
            }`}
          >
            ${formatted}
          </span>
          {phase === "settled" && (
            <span className="font-mono text-[10px] text-emerald-500/60 ml-auto">settled</span>
          )}
        </div>
      </div>
    </div>
  );
}

// Mini debate trace matching actual app UI
function LiveDebateTrace() {
  const [visibleTurns, setVisibleTurns] = useState(0);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const turns = useMemo(
    () => [
      {
        model: "anthropic/claude-opus-4.6",
        phase: "Opening",
        content: "The monorepo approach reduces deployment complexity by 40% based on our dependency graph analysis...",
      },
      {
        model: "openai/gpt-5.4",
        phase: "Challenge",
        content: "However, the coupling risk increases significantly when team size exceeds 8 engineers. The blast radius of a bad merge...",
      },
      {
        model: "x-ai/grok-4.1-fast",
        phase: "Rebuttal",
        content: "Both arguments miss the migration cost. A phased approach starting with shared libs would reduce risk while preserving...",
      },
    ],
    []
  );

  useEffect(() => {
    if (!isInView) {
      setVisibleTurns(0);
      setShowSynthesis(false);
      return;
    }

    setVisibleTurns(0);
    setShowSynthesis(false);

    const timers: ReturnType<typeof setTimeout>[] = [];
    turns.forEach((_, i) => {
      timers.push(setTimeout(() => setVisibleTurns(i + 1), (i + 1) * 2000));
    });
    timers.push(setTimeout(() => setShowSynthesis(true), (turns.length + 1) * 2000));
    // Reset and loop
    timers.push(
      setTimeout(() => {
        setVisibleTurns(0);
        setShowSynthesis(false);
      }, (turns.length + 3) * 2000)
    );

    return () => timers.forEach(clearTimeout);
  }, [isInView, turns]);

  return (
    <div ref={ref} className="w-full max-w-[380px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        {/* Debate header */}
        <div className="flex items-center gap-2 px-3 py-2 border-b border-foreground/[0.04]">
          <span className="font-mono text-[10px] text-amber-500/70 uppercase tracking-wider">
            {showSynthesis ? "Synthesis" : visibleTurns > 0 ? "Debating" : "Debate"}
          </span>
          <span className="flex items-center gap-1 ml-1">
            {DEBATE_MODELS.map((id) => (
              <span
                key={id}
                className="h-1.5 w-1.5 rounded-full"
                style={{ backgroundColor: getModel(id).color }}
              />
            ))}
          </span>
        </div>

        {/* Debate turns */}
        <div className="p-3 space-y-3 min-h-[160px]">
          {turns.slice(0, visibleTurns).map((turn, i) => {
            const model = getModel(turn.model);
            const isLatest = i === visibleTurns - 1 && !showSynthesis;
            return (
              <motion.div
                key={`${turn.model}-${turn.phase}`}
                className="text-[12px] text-muted-foreground/70"
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.4 }}
              >
                <span
                  className={`font-mono text-[10px] font-medium ${isLatest ? "thinking-shimmer" : ""}`}
                  style={{ color: model.color }}
                >
                  {shortModelName(turn.model)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/40 ml-1.5">
                  {turn.phase}
                </span>
                <p className="mt-1 italic leading-relaxed text-[11px]">
                  {turn.content}
                  {isLatest && (
                    <span className="inline-block w-1.5 h-3 bg-amber-500/50 ml-0.5 animate-pulse" />
                  )}
                </p>
              </motion.div>
            );
          })}

          {showSynthesis && (
            <motion.div
              className="text-[12px] border-t border-amber-500/10 pt-3"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ duration: 0.6 }}
            >
              <span className="font-mono text-[10px] text-amber-500/70">Synthesis</span>
              <p className="mt-1 text-[11px] text-foreground/60 leading-relaxed">
                Phased monorepo migration wins. Start with shared libraries, expand module boundaries after team stabilizes at 12. Trade-off: 2-week delay. Risk: low.
              </p>
              <p className="mt-2 font-mono text-[10px] text-emerald-500/60">Ready to lock as decision</p>
            </motion.div>
          )}
        </div>
      </div>
    </div>
  );
}

// Decision record card matching app inspector UI
function LiveDecisionCard() {
  const [phase, setPhase] = useState<"draft" | "filling" | "locking" | "locked">("draft");
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  useEffect(() => {
    if (!isInView) {
      setPhase("draft");
      return;
    }

    const timers = [
      setTimeout(() => setPhase("filling"), 1500),
      setTimeout(() => setPhase("locking"), 3500),
      setTimeout(() => setPhase("locked"), 4500),
      setTimeout(() => setPhase("draft"), 7000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isInView]);

  return (
    <div ref={ref} className="w-full max-w-[320px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-foreground/[0.04] flex items-center justify-between">
          <span className="font-mono text-[11px] text-foreground/70">Decision #0047</span>
          <span
            className={`font-mono text-[10px] px-2 py-0.5 rounded-full ${
              phase === "locked"
                ? "bg-emerald-500/10 text-emerald-500/70"
                : phase === "locking"
                  ? "bg-amber-500/10 text-amber-500/70"
                  : "bg-foreground/[0.04] text-muted-foreground/40"
            }`}
          >
            {phase === "locked" ? "Locked" : phase === "locking" ? "Locking..." : "Draft"}
          </span>
        </div>
        <div className="p-4 space-y-3">
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Context</div>
            <div className={`text-[12px] leading-relaxed transition-opacity duration-500 ${phase === "draft" ? "text-muted-foreground/20" : "text-foreground/60"}`}>
              {phase === "draft" ? "—" : "Architecture decision for new dashboard service. Monorepo vs polyrepo."}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Choice</div>
            <div className={`text-[12px] font-medium transition-opacity duration-500 ${phase === "draft" ? "text-muted-foreground/20" : "text-foreground/70"}`}>
              {phase === "draft" ? "—" : "Phased monorepo migration"}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Trade-offs</div>
            <div className={`text-[11px] leading-relaxed transition-opacity duration-500 ${phase === "draft" ? "text-muted-foreground/20" : "text-muted-foreground/50"}`}>
              {phase === "draft" ? "—" : "2-week delay to production. Lower coupling risk. Team ramp needed."}
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Dissent</div>
            <div className={`text-[11px] leading-relaxed transition-opacity duration-500 ${phase === "draft" ? "text-muted-foreground/20" : "text-muted-foreground/50"}`}>
              {phase === "draft" ? "—" : "GPT-5.4 favored immediate full migration."}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Model grid matching actual model picker UI
function LiveModelGrid() {
  const [activeIdx, setActiveIdx] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const displayModels = MODELS.filter((m) => m.id !== "auto");

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setActiveIdx((i) => (i + 1) % displayModels.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [isInView, displayModels.length]);

  return (
    <div ref={ref} className="w-full max-w-[380px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        <div className="p-1.5 space-y-0.5">
          {displayModels.map((m, i) => (
            <div
              key={m.id}
              className={`flex items-center gap-2.5 rounded-lg px-2.5 py-2 transition-colors ${
                i === activeIdx ? "bg-foreground/[0.07]" : ""
              }`}
            >
              <ModelLogo model={m} size={14} />
              <div className="min-w-0 flex-1">
                <div className="text-[11px] font-medium text-foreground/80 truncate">{m.name}</div>
                <div className="text-[9px] text-muted-foreground/40 font-mono">{m.provider}</div>
              </div>
              {i === activeIdx && (
                <motion.div
                  className="flex items-center gap-1"
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                >
                  <span className="font-mono text-[9px] text-muted-foreground/40">routing</span>
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/50 animate-pulse" />
                </motion.div>
              )}
            </div>
          ))}
          {/* Auto row */}
          <div className="flex items-center gap-2.5 rounded-lg px-2.5 py-2 border-t border-foreground/[0.04] mt-1">
            <ProviderLogo provider="Meter" size={14} />
            <div className="min-w-0">
              <div className="text-[11px] font-medium text-foreground/80">Auto</div>
              <div className="text-[9px] text-muted-foreground/40 font-mono">Meter routes for you</div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Spec kit file list with animated progress
function LiveSpecKit() {
  const [progress, setProgress] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const files = ["README.md", "ARCHITECTURE.md", "DESIGN.md", "DECISIONS.md", "CLAUDE.md"];

  useEffect(() => {
    if (!isInView) {
      setProgress(0);
      return;
    }
    setProgress(0);
    const interval = setInterval(() => {
      setProgress((p) => {
        if (p >= files.length) {
          // Reset after pause
          setTimeout(() => setProgress(0), 2000);
          return p;
        }
        return p + 1;
      });
    }, 800);
    return () => clearInterval(interval);
  }, [isInView, files.length]);

  return (
    <div ref={ref} className="w-full max-w-[320px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-foreground/[0.04] flex items-center justify-between">
          <span className="font-mono text-[11px] text-foreground/70">Agent Spec Kit</span>
          <span
            className={`font-mono text-[10px] ${
              progress >= files.length ? "text-emerald-500/60" : "text-muted-foreground/30"
            }`}
          >
            {progress >= files.length ? "Ready" : "Generating..."}
          </span>
        </div>
        <div className="p-3 space-y-1.5">
          {files.map((file, i) => {
            const done = i < progress;
            const active = i === progress - 1 && progress < files.length;
            return (
              <div
                key={file}
                className={`flex items-center gap-2 px-2 py-1.5 rounded-md transition-colors ${
                  done ? "bg-foreground/[0.03]" : ""
                }`}
              >
                <span className={`text-[10px] ${done ? "text-emerald-500/60" : "text-muted-foreground/20"}`}>
                  {done ? "✓" : "○"}
                </span>
                <span
                  className={`font-mono text-[11px] flex-1 ${
                    done ? "text-foreground/60" : "text-muted-foreground/25"
                  } ${active ? "thinking-shimmer" : ""}`}
                >
                  {file}
                </span>
                {done && (
                  <span className="font-mono text-[9px] text-muted-foreground/30">
                    {(0.2 + Math.random() * 0.8).toFixed(1)}kb
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// Settle UI card
function LiveSettleCard() {
  const [phase, setPhase] = useState<"running" | "approaching" | "settling" | "settled">("running");
  const [amount, setAmount] = useState(2.47);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  useEffect(() => {
    if (!isInView) {
      setPhase("running");
      setAmount(2.47);
      return;
    }

    const timers = [
      setTimeout(() => { setPhase("approaching"); setAmount(4.89); }, 2000),
      setTimeout(() => { setPhase("settling"); setAmount(5.00); }, 4000),
      setTimeout(() => { setPhase("settled"); setAmount(0); }, 5500),
      setTimeout(() => { setPhase("running"); setAmount(2.47); }, 8000),
    ];
    return () => timers.forEach(clearTimeout);
  }, [isInView]);

  return (
    <div ref={ref} className="w-full max-w-[320px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-foreground/[0.04]">
          <div className="flex items-center justify-between mb-2">
            <span className="font-mono text-[11px] text-foreground/70">Current tab</span>
            <span className={`font-mono text-[14px] tabular-nums ${
              phase === "settled" ? "text-emerald-500/70" : "text-foreground/80"
            }`}>
              ${amount.toFixed(2)}
            </span>
          </div>
          <div className="w-full h-1.5 rounded-full bg-foreground/[0.04] overflow-hidden">
            <motion.div
              className={`h-full rounded-full ${
                phase === "settled" ? "bg-emerald-500/40" :
                phase === "approaching" || phase === "settling" ? "bg-amber-500/50" : "bg-foreground/20"
              }`}
              animate={{ width: `${Math.min((amount / 5) * 100, 100)}%` }}
              transition={{ duration: 0.5 }}
            />
          </div>
          <div className="flex items-center justify-between mt-1">
            <span className="font-mono text-[9px] text-muted-foreground/30">$0</span>
            <span className="font-mono text-[9px] text-muted-foreground/30">$5.00 cap</span>
          </div>
        </div>
        <div className="p-3 text-center">
          <span className={`font-mono text-[10px] ${
            phase === "settled" ? "text-emerald-500/60" :
            phase === "settling" ? "text-amber-500/60 thinking-shimmer" :
            "text-muted-foreground/30"
          }`}>
            {phase === "settled" ? "✓ Auto-settled. Tab reset." :
             phase === "settling" ? "Settling..." :
             phase === "approaching" ? "Approaching cap..." :
             "Tab running"}
          </span>
        </div>
      </div>
    </div>
  );
}

// Spend monitor with mini sparkline
function LiveSpendMonitor() {
  const [data, setData] = useState({ today: 0.42, week: 3.17, cap: 50 });
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setData((d) => ({
        ...d,
        today: Math.round((d.today + 0.01 + Math.random() * 0.03) * 100) / 100,
        week: Math.round((d.week + 0.01 + Math.random() * 0.03) * 100) / 100,
      }));
    }, 2000);
    return () => clearInterval(interval);
  }, [isInView]);

  return (
    <div ref={ref} className="w-full max-w-[320px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-foreground/[0.04]">
          <span className="font-mono text-[11px] text-foreground/70">Spend Monitor</span>
        </div>
        <div className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground/50">Today</span>
            <span className="font-mono text-[12px] text-foreground/70 tabular-nums">${data.today.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground/50">This week</span>
            <span className="font-mono text-[12px] text-foreground/70 tabular-nums">${data.week.toFixed(2)}</span>
          </div>
          <div className="flex items-center justify-between">
            <span className="text-[12px] text-muted-foreground/50">Cap</span>
            <span className="font-mono text-[12px] text-foreground/70 tabular-nums">${data.cap.toFixed(2)}</span>
          </div>
          <div className="pt-1">
            <div className="w-full h-1 rounded-full bg-foreground/[0.04]">
              <div
                className="h-full rounded-full bg-foreground/20 transition-all duration-500"
                style={{ width: `${(data.week / data.cap) * 100}%` }}
              />
            </div>
            <div className="flex justify-between mt-1">
              <span className="font-mono text-[8px] text-muted-foreground/20">{((data.week / data.cap) * 100).toFixed(0)}% of cap</span>
              <span className="font-mono text-[8px] text-muted-foreground/20">${data.cap}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Section Reveal Wrapper ─────────────────────────────────────────────

function RevealSection({ children, className, delay = 0 }: {
  children: React.ReactNode;
  className?: string;
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-80px" });

  return (
    <motion.section
      ref={ref}
      className={className}
      initial={{ opacity: 0, y: 40 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 40 }}
      transition={{ duration: 0.8, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      {children}
    </motion.section>
  );
}

// ── Model logos row (replaces noisy ticker) ───────────────────────────

function ModelLogosRow() {
  const displayModels = MODELS.filter((m) => m.id !== "auto");

  return (
    <div className="flex items-center justify-center gap-6 sm:gap-8 py-6 border-y border-foreground/[0.03]">
      {displayModels.map((m) => (
        <div key={m.id} className="flex items-center gap-1.5 opacity-25 hover:opacity-50 transition-opacity">
          <ModelLogo model={m} size={14} />
          <span className="font-mono text-[10px] text-muted-foreground/60 hidden sm:block">{m.name}</span>
        </div>
      ))}
    </div>
  );
}

// ── Feature Section (text + UI animation side by side) ─────────────

function FeatureSection({
  label,
  title,
  description,
  children,
  reverse = false,
  delay = 0,
}: {
  label: string;
  title: React.ReactNode;
  description: string;
  children: React.ReactNode;
  reverse?: boolean;
  delay?: number;
}) {
  return (
    <RevealSection className="relative z-10 py-24 sm:py-32 px-6" delay={delay}>
      <div className="max-w-5xl mx-auto">
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center ${reverse ? "direction-rtl" : ""}`}>
          <div className={reverse ? "lg:order-2" : ""}>
            <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
              {label}
            </p>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
              {title}
            </h2>
            <p className="text-base text-muted-foreground/60 leading-relaxed">
              {description}
            </p>
          </div>
          <div className={`flex items-center justify-center p-6 sm:p-8 ${reverse ? "lg:order-1" : ""}`}>
            {children}
          </div>
        </div>
      </div>
    </RevealSection>
  );
}

// ── Auth Buttons Component ─────────────────────────────────────────────

function AuthButtons({
  step,
  loading,
  error,
  status,
  onContinue,
  onCreateAccount,
  onCrossDevice,
  onBack,
}: {
  step: AuthStep;
  loading: boolean;
  error: string | null;
  status: string | null;
  onContinue: () => void;
  onCreateAccount: () => void;
  onCrossDevice: () => void;
  onBack: () => void;
}) {
  if (step === "passkey") {
    return (
      <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
        <button
          onClick={onContinue}
          disabled={loading}
          className="w-full h-12 rounded-xl bg-foreground text-background text-sm font-medium transition-all hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-foreground/5"
        >
          {loading && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {loading ? "Authenticating..." : "Start thinking"}
        </button>
        <a
          href="/docs"
          className="font-mono text-[11px] text-muted-foreground/40 hover:text-muted-foreground transition-colors tracking-wide"
        >
          Learn more
        </a>
        {error && (
          <p className="font-mono text-[11px] text-red-400">{error}</p>
        )}
        {status && !error && (
          <p className="font-mono text-[11px] text-muted-foreground/60">{status}</p>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center gap-3 w-full max-w-xs mx-auto">
      <p className="text-sm text-muted-foreground">
        No account found on this device
      </p>
      {error && (
        <p className="font-mono text-[11px] text-red-400">{error}</p>
      )}
      {status && !error && (
        <p className="font-mono text-[11px] text-muted-foreground/60">{status}</p>
      )}
      <button
        onClick={onCreateAccount}
        disabled={loading}
        className="w-full h-12 rounded-xl bg-foreground text-background text-sm font-medium transition-all hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-foreground/5"
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {loading ? "Setting up..." : "Create new account"}
      </button>
      <button
        onClick={onCrossDevice}
        disabled={loading}
        className="w-full h-10 rounded-xl border border-foreground/[0.08] text-foreground text-sm font-medium transition-colors hover:bg-foreground/[0.03] active:bg-foreground/[0.05] disabled:opacity-50"
      >
        Sign in from another device
      </button>
      <button
        onClick={onBack}
        className="font-mono text-[10px] text-muted-foreground/30 hover:text-muted-foreground transition-colors"
      >
        Back
      </button>
    </div>
  );
}

// ── Subscription comparison logos ──────────────────────────────────────

function SubscriptionLogos() {
  const logos = [
    { name: "ChatGPT", price: "$20/mo" },
    { name: "Claude", price: "$20/mo" },
    { name: "Gemini", price: "$20/mo" },
    { name: "Grok", price: "$30/mo" },
  ];

  return (
    <div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
      {logos.map((logo, i) => (
        <motion.div
          key={logo.name}
          className="flex items-center gap-2 px-4 py-2.5 rounded-full border border-foreground/[0.06] bg-foreground/[0.02] line-through decoration-foreground/20"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.3 + i * 0.1, duration: 0.5 }}
        >
          <span className="text-sm text-foreground/40">{logo.name}</span>
          <span className="font-mono text-xs text-foreground/25">{logo.price}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main Landing Page ──────────────────────────────────────────────────

export function LandingPage() {
  const { setAuth, setCardOnFile } = useMeterStore();
  const [step, setStep] = useState<AuthStep>("passkey");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.12], [1, 0.97]);

  // ── Auth handlers ──────────────────────────────────────────────────

  const afterPasskey = async (user: PendingUser, method?: string) => {
    const currentUserId = useMeterStore.getState().userId;
    if (currentUserId && currentUserId !== user.id) {
      await useMeterStore.getState().logout();
    }
    setAuth(user.id, user.handle ?? null, user.email ?? "", (user.accountType as "standard" | "superadmin") ?? "standard", user.markupMultiplier ?? 2);
    identifyUser(user.id, { email: user.email, accountType: user.accountType ?? "standard", cardOnFile: user.cardOnFile });
    if (method === "register") {
      trackAccountCreated({ method: "passkey" });
    } else {
      trackUserLoggedIn({ method: method ?? "passkey" });
    }
    if (user.cardOnFile) {
      setCardOnFile(true, user.cardLast4 ?? undefined, user.cardBrand);
    }
  };

  const handleContinue = async () => {
    setLoading(true);
    setError(null);
    setStatus("Checking for passkey...");
    try {
      if (typeof PublicKeyCredential === "undefined" || !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())) {
        setStep("no-account");
        setLoading(false);
        setStatus(null);
        return;
      }
      const optRes = await fetch(apiUrl("/api/auth/passkey"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-options" }) });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");
      setStatus("Authenticating...");
      const credential = await navigator.credentials.get({
        publicKey: { challenge: base64URLStringToBuffer(optData.options.challenge), rpId: optData.options.rpId, timeout: 15000, userVerification: optData.options.userVerification ?? "preferred", allowCredentials: [] },
        // @ts-expect-error -- hints is WebAuthn L3
        hints: ["client-device"],
      });
      if (!credential) { setStep("no-account"); setLoading(false); setStatus(null); return; }
      setStatus("Verifying...");
      const verifyRes = await fetch(apiUrl("/api/auth/passkey"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-verify", challengeId: optData.challengeId, credential: credentialToJSON(credential as PublicKeyCredential) }) });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Login failed");
      afterPasskey(verifyData.user, "login");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.includes("NotAllowedError") || msg.includes("not allowed") || msg.includes("AbortError") || msg.includes("timed out") || msg.includes("The operation either timed out")) {
        setStep("no-account"); setLoading(false); setStatus(null); return;
      }
      if (msg.includes("user could not be verified") || msg.includes("User verification")) {
        setError("Device verification failed. Make sure Face ID, Touch ID, or a PIN is set up.");
        trackLoginFailed({ method: "passkey", error: "device_verification_failed" });
      } else { setError(msg); trackLoginFailed({ method: "passkey", error: msg }); }
      setLoading(false);
      setStatus(null);
    }
  };

  const handleCreateAccount = async () => {
    setLoading(true);
    setError(null);
    setStatus("Setting up passkey...");
    try {
      const optRes = await fetch(apiUrl("/api/auth/passkey"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "register-options" }) });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");
      const credential = await startRegistration({ optionsJSON: optData.options });
      setStatus("Verifying...");
      const verifyRes = await fetch(apiUrl("/api/auth/passkey"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "register-verify", challengeId: optData.challengeId, credential, userId: optData.userId }) });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Registration failed");
      afterPasskey(verifyData.user, "register");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.includes("timed out") || msg.includes("not allowed") || msg.includes("AbortError") || msg.includes("NotAllowedError")) {
        setError("Passkey prompt was cancelled. Try again.");
        trackLoginFailed({ method: "passkey_register", error: "cancelled" });
      } else if (msg.includes("user could not be verified") || msg.includes("User verification")) {
        setError("Device verification failed. Make sure Face ID, Touch ID, or a PIN is set up.");
        trackLoginFailed({ method: "passkey_register", error: "device_verification_failed" });
      } else { setError(msg); trackLoginFailed({ method: "passkey_register", error: msg }); }
      setLoading(false);
      setStatus(null);
    }
  };

  const handleCrossDevice = async () => {
    setLoading(true);
    setError(null);
    setStatus("Waiting for cross-device authentication...");
    trackCrossDeviceAuthStarted();
    try {
      const optRes = await fetch(apiUrl("/api/auth/passkey"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-options" }) });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");
      const credential = await navigator.credentials.get({
        publicKey: { challenge: base64URLStringToBuffer(optData.options.challenge), rpId: optData.options.rpId, timeout: optData.options.timeout ?? 120000, userVerification: optData.options.userVerification ?? "preferred", allowCredentials: [] },
      });
      if (!credential) { setError("No credential received. Try again."); setLoading(false); setStatus(null); return; }
      setStatus("Verifying...");
      const verifyRes = await fetch(apiUrl("/api/auth/passkey"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-verify", challengeId: optData.challengeId, credential: credentialToJSON(credential as PublicKeyCredential) }) });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Login failed");
      afterPasskey(verifyData.user, "cross_device");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.includes("timed out") || msg.includes("not allowed") || msg.includes("AbortError") || msg.includes("NotAllowedError")) {
        setError("Authentication was cancelled. Try again.");
        trackLoginFailed({ method: "cross_device", error: "cancelled" });
      } else { setError(msg); trackLoginFailed({ method: "cross_device", error: msg }); }
      setLoading(false);
      setStatus(null);
    }
  };

  return (
    <div ref={containerRef} className="relative min-h-screen bg-background text-foreground overflow-x-hidden">

      {/* ── Navigation ─────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-5 bg-background/80 backdrop-blur-xl border-b border-foreground/[0.03]">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <Image
            src="/logo-dark-copy.webp"
            alt="Meter"
            width={80}
            height={22}
            priority
            className="hidden dark:block"
          />
          <Image
            src="/logo-light.webp"
            alt="Meter"
            width={80}
            height={22}
            className="block dark:hidden"
          />
          <div className="flex items-center gap-6">
            <a
              href="/docs"
              className="font-mono text-[11px] text-muted-foreground/50 hover:text-foreground transition-colors tracking-wide hidden sm:block"
            >
              Docs
            </a>
            <a
              href="/console"
              className="font-mono text-[11px] text-muted-foreground/50 hover:text-foreground transition-colors tracking-wide hidden sm:block"
            >
              Console
            </a>
            <button
              onClick={handleContinue}
              className="h-8 px-4 rounded-lg bg-foreground/[0.06] border border-foreground/[0.06] text-foreground text-xs font-medium transition-all hover:bg-foreground/[0.1] hover:border-foreground/[0.12]"
            >
              Sign in
            </button>
          </div>
        </div>
      </nav>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <motion.section
        className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6 pt-20"
        style={{ opacity: heroOpacity, scale: heroScale }}
      >
        <motion.div
          className="text-center w-full max-w-3xl mx-auto"
          initial={{ opacity: 0, y: 30 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 1, ease: [0.25, 0.46, 0.45, 0.94] }}
        >
          {/* Pill badge */}
          <motion.div
            className="inline-flex items-center px-3 py-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.03] mb-8"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.2, duration: 0.6 }}
          >
            <span className="font-mono text-[10px] tracking-[0.2em] text-muted-foreground/50 uppercase">
              Pay-Per-Thought AI
            </span>
          </motion.div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tighter leading-[0.95] mb-6">
            Think Freely.
          </h1>

          <motion.p
            className="text-lg sm:text-xl text-muted-foreground/60 max-w-lg mx-auto leading-relaxed mb-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
          >
            Use any model. Keep your thoughts private.
            Pay only for what you use.
          </motion.p>

          <motion.div
            className="flex justify-center"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.7, duration: 0.6 }}
          >
            <AuthButtons
              step={step}
              loading={loading}
              error={error}
              status={status}
              onContinue={handleContinue}
              onCreateAccount={handleCreateAccount}
              onCrossDevice={handleCrossDevice}
              onBack={() => { setStep("passkey"); setError(null); setStatus(null); }}
            />
          </motion.div>

          <motion.p
            className="font-mono text-[10px] text-muted-foreground/20 mt-8 tracking-wide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.8 }}
          >
            Now live in public beta. No credit card required.
          </motion.p>
        </motion.div>

        {/* Scroll indicator */}
        <motion.div
          className="absolute bottom-8 left-1/2 -translate-x-1/2"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1.5, duration: 0.8 }}
        >
          <motion.div
            className="w-5 h-8 rounded-full border border-foreground/10 flex items-start justify-center p-1"
            animate={{ opacity: [0.3, 0.6, 0.3] }}
            transition={{ duration: 2, repeat: Infinity }}
          >
            <motion.div
              className="w-1 h-1.5 rounded-full bg-foreground/30"
              animate={{ y: [0, 12, 0] }}
              transition={{ duration: 2, repeat: Infinity, ease: "easeInOut" }}
            />
          </motion.div>
        </motion.div>
      </motion.section>

      {/* ── Ambient pulse below hero ───────────────────────────────── */}
      <div className="relative z-10">
        <MeterPulse />
      </div>

      {/* ── Model logos (quiet, replaces noisy ticker) ─────────────── */}
      <div className="relative z-10">
        <ModelLogosRow />
      </div>

      {/* ── The problem ────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-8">
            The problem
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-6 leading-tight">
            Why pay hundreds a month for subscriptions you barely use?
          </h2>
          <div className="mb-8">
            <SubscriptionLogos />
          </div>
          <p className="text-base text-muted-foreground/50 max-w-md mx-auto leading-relaxed">
            Execution has become easy. Cursor writes your code. Vercel ships it.
            The bottleneck is now the thinking that happens before the first commit.
          </p>
        </div>
      </RevealSection>

      {/* ── Privacy promise (moved up — principle, not feature) ───── */}
      <RevealSection className="relative z-10 py-12 sm:py-16 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <div className="inline-flex items-center gap-2 px-4 py-2 rounded-full border border-foreground/[0.06] bg-foreground/[0.02]">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="text-foreground/40">
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
            <span className="text-sm text-foreground/50">
              Your thoughts stay your thoughts. No training on your data. No selling your prompts. Private by default.
            </span>
          </div>
        </div>
      </RevealSection>

      {/* ── The thesis ─────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-16 sm:py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-6">
            The thesis
          </p>
          <blockquote className="text-xl sm:text-2xl font-medium text-foreground/60 leading-snug tracking-tight italic mb-6">
            &ldquo;A brilliant codebase built on a broken decision is still a broken product.&rdquo;
          </blockquote>
        </div>
      </RevealSection>

      {/* ── Three layers of intelligence ───────────────────────────── */}
      <RevealSection className="relative z-10 py-16 sm:py-24 px-6">
        <div className="max-w-3xl mx-auto">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-8 text-center">
            What Meter does
          </p>
          <h2 className="text-2xl sm:text-3xl font-semibold tracking-tight mb-12 text-center">
            Three layers of intelligence
          </h2>
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            <div>
              <div className="font-mono text-[11px] text-muted-foreground/30 mb-2">01</div>
              <h3 className="text-lg font-semibold mb-2">Route</h3>
              <p className="text-sm text-muted-foreground/50 leading-relaxed">
                Every frontier model on one postpaid tab. Auto-routing picks the optimal model for each task. No rate limits.
              </p>
            </div>
            <div>
              <div className="font-mono text-[11px] text-muted-foreground/30 mb-2">02</div>
              <h3 className="text-lg font-semibold mb-2">Debate</h3>
              <p className="text-sm text-muted-foreground/50 leading-relaxed">
                Force models into adversarial positions. Each critiques the other&apos;s strongest argument. Get a synthesis with trade-offs.
              </p>
            </div>
            <div>
              <div className="font-mono text-[11px] text-muted-foreground/30 mb-2">03</div>
              <h3 className="text-lg font-semibold mb-2">Record</h3>
              <p className="text-sm text-muted-foreground/50 leading-relaxed">
                Lock decisions as structured records — not chat logs. Context, choice, trade-offs, dissent. Auto-generate your Agent Spec Kit.
              </p>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ── Pay-per-thought (with live meter pill) ──────────────── */}
      <FeatureSection
        label="Pay per thought"
        title={<>Watch your cost tick up in real time.<br /><span className="text-foreground/40">Pennies, not subscriptions.</span></>}
        description="Every response shows its cost as it streams. Pennies per thought, not $20/month for 5 messages worth of value. Pay only for what you use."
      >
        <LiveMeterPill />
      </FeatureSection>

      {/* ── Every frontier model (with live model grid) ───────────── */}
      <FeatureSection
        label="Every frontier model"
        title={<>Every frontier model.<br /><span className="text-foreground/40">One bill.</span></>}
        description="Access Claude, GPT, Gemini, Grok, DeepSeek, and MiniMax on a single postpaid tab. Auto-routing selects the optimal model based on task complexity, cost, and availability."
        reverse
      >
        <LiveModelGrid />
      </FeatureSection>

      {/* ── Debate mode (with live debate trace) ────────────────── */}
      <FeatureSection
        label="Debate mode"
        title={<>Adversarial intelligence.<br /><span className="text-foreground/40">No single model could produce this alone.</span></>}
        description="Pit Claude against GPT against Gemini on your hardest strategic questions. Four-phase adversarial structure forces models to attack each other's logic. Opening, Challenge, Rebuttal, Synthesis."
      >
        <LiveDebateTrace />
      </FeatureSection>

      {/* ── Decision records (with live decision card) ──────────── */}
      <FeatureSection
        label="Decision records"
        title={<>When you have conviction,<br /><span className="text-foreground/40">lock it.</span></>}
        description="Decisions are structured records — not chat logs. Context, choice, trade-offs, and dissent. Timestamped and versioned. Your thinking becomes institutional memory."
        reverse
      >
        <LiveDecisionCard />
      </FeatureSection>

      {/* ── Auto-settle (with live settle card) ─────────────────── */}
      <FeatureSection
        label="Auto-settle"
        title={<>Your tab runs in the background.<br /><span className="text-foreground/40">No invoices. No surprises.</span></>}
        description="Set a spending cap. Meter charges you automatically when you hit it. Your balance resets and you keep thinking. No bookkeeping. No monthly invoices."
        reverse
      >
        <LiveSettleCard />
      </FeatureSection>

      {/* ── Agent Spec Kit (with live spec kit) ─────────────────── */}
      <FeatureSection
        label="Agent Spec Kit"
        title={<>Generate structured specs.<br /><span className="text-foreground/40">So coding agents start with perfect context.</span></>}
        description="Turn your decisions into structured documents — README, ARCHITECTURE, DESIGN, DECISIONS, CLAUDE.md. Share them with your team or feed them directly to your coding agents through our MCP server."
      >
        <LiveSpecKit />
      </FeatureSection>

      {/* ── Spend controls (with live spend monitor) ────────────── */}
      <FeatureSection
        label="Spend controls"
        title={<>Full visibility.<br /><span className="text-foreground/40">Set caps and limits.</span></>}
        description="Real-time usage dashboard. Set daily caps, monthly limits, per-transaction maximums. Full visibility into which models cost what. Never overspend."
        reverse
      >
        <LiveSpendMonitor />
      </FeatureSection>

      {/* ── MCP Server ─────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-24 sm:py-32 px-6 bg-foreground/[0.01]">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-center">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
                For your AI coders
              </p>
              <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
                Connect through our MCP server.
                <br />
                <span className="text-foreground/40">Full context, always.</span>
              </h2>
              <p className="text-base text-muted-foreground/60 leading-relaxed">
                Your AI coding agents get full context of your decisions and specs
                through Meter&apos;s MCP server. No more pasting specs into prompts.
                Your agents start with everything they need.
              </p>
            </div>

            <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <div className="text-muted-foreground/30 mb-1">{"// Connect your coding agent"}</div>
              <div>
                <span className="text-foreground/40">{"{"}</span>
              </div>
              <div className="pl-4">
                <span className="text-foreground/50">{`"mcpServers"`}</span>
                <span className="text-foreground/30">{": {"}</span>
              </div>
              <div className="pl-8">
                <span className="text-foreground/50">{`"meter"`}</span>
                <span className="text-foreground/30">{": {"}</span>
              </div>
              <div className="pl-12">
                <span className="text-foreground/40">{`"url"`}</span>
                <span className="text-foreground/30">{": "}</span>
                <span className="text-foreground/50">{`"https://meter.chat/mcp"`}</span>
              </div>
              <div className="pl-8">
                <span className="text-foreground/30">{"}"}</span>
              </div>
              <div className="pl-4">
                <span className="text-foreground/30">{"}"}</span>
              </div>
              <div>
                <span className="text-foreground/40">{"}"}</span>
              </div>
              <div className="mt-3 text-muted-foreground/30">{"// Decisions + specs, always in context."}</div>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ── Pricing ────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
            Pricing
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
            Pay for what you think. Nothing else.
          </h2>
          <p className="text-base text-muted-foreground/50 mb-10 max-w-md mx-auto leading-relaxed">
            No seats. No tiers. No annual contracts. Use any model, pay per token.
            Set a hard cap so you never overspend.
          </p>
          <div className="inline-flex flex-col items-center gap-4 rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-8">
            <div className="text-sm text-muted-foreground/40">Starting from</div>
            <div className="flex items-baseline gap-1">
              <span className="text-4xl font-semibold">$0</span>
              <span className="text-muted-foreground/40">/mo</span>
            </div>
            <div className="font-mono text-[11px] text-muted-foreground/40">+ tokens consumed</div>
            <div className="flex flex-wrap justify-center gap-3 mt-2">
              <span className="font-mono text-[10px] text-muted-foreground/30 px-2 py-1 rounded border border-foreground/[0.04]">No subscription</span>
              <span className="font-mono text-[10px] text-muted-foreground/30 px-2 py-1 rounded border border-foreground/[0.04]">Postpaid billing</span>
              <span className="font-mono text-[10px] text-muted-foreground/30 px-2 py-1 rounded border border-foreground/[0.04]">Hard wallet cap</span>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <section className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <RevealSection>
            <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
              Public beta
            </p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
              Start thinking.
            </h2>
            <p className="text-base text-muted-foreground/50 mb-10 max-w-md mx-auto leading-relaxed">
              No credit card required. No subscription. Just open Meter
              and think. Pay for what you use.
            </p>
            <div className="flex justify-center">
              <AuthButtons
                step={step}
                loading={loading}
                error={error}
                status={status}
                onContinue={handleContinue}
                onCreateAccount={handleCreateAccount}
                onCrossDevice={handleCrossDevice}
                onBack={() => { setStep("passkey"); setError(null); setStatus(null); }}
              />
            </div>
          </RevealSection>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-foreground/[0.04] py-8 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image
              src="/logo-dark-copy.webp"
              alt="Meter"
              width={60}
              height={16}
              className="hidden dark:block opacity-30"
            />
            <Image
              src="/logo-light.webp"
              alt="Meter"
              width={60}
              height={16}
              className="block dark:hidden opacity-30"
            />
            <span className="font-mono text-[10px] text-muted-foreground/20">
              pay per thought
            </span>
          </div>

          <div className="flex items-center gap-6">
            <a href="/terms" className="font-mono text-[10px] text-muted-foreground/20 hover:text-muted-foreground/50 transition-colors">
              Terms
            </a>
            <a href="/privacy" className="font-mono text-[10px] text-muted-foreground/20 hover:text-muted-foreground/50 transition-colors">
              Privacy
            </a>
            <a href="https://github.com/meterchat/meter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/20 hover:text-muted-foreground/50 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
            <a href="https://x.com/meterchat" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/20 hover:text-muted-foreground/50 transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
