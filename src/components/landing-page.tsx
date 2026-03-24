"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { motion, useScroll, useTransform, useInView } from "framer-motion";
import dynamic from "next/dynamic";
import { useMeterStore } from "@/lib/store";
import { DEFAULT_MARKUP_MULTIPLIER } from "@/lib/models";
import { authFetch } from "@/lib/auth-fetch";
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
import { FeatureBoxGrid } from "./feature-boxes";

const Liveline = dynamic(() => import("liveline").then((m) => m.Liveline), {
  ssr: false,
  loading: () => <div className="h-[28px]" />,
});

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

// Hero liveline that cycles through models with matching colors
function HeroLiveline({ activeModelIdx }: { activeModelIdx: number }) {
  const displayModels = MODELS.filter((m) => m.id !== "auto");
  const model = displayModels[activeModelIdx % displayModels.length];
  const [data, setData] = useState<{ time: number; value: number }[]>([]);
  const [currentRate, setCurrentRate] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false });

  // Generate simulated token stream data
  useEffect(() => {
    if (!isInView) return;
    const now = Math.floor(Date.now() / 1000);
    setData([{ time: now - 5, value: 0 }, { time: now, value: 0 }]);

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      // Simulate bursty token arrival
      const burst = Math.random() > 0.3 ? Math.floor(Math.random() * 80 + 20) : Math.floor(Math.random() * 10);
      const rate = burst * 2;
      setCurrentRate(rate);
      setData((d) => {
        const next = [...d, { time: nowSec, value: rate }];
        const cutoff = nowSec - 30;
        return next.filter((p) => p.time >= cutoff);
      });
    }, 500);

    return () => clearInterval(interval);
  }, [isInView]);

  return (
    <div ref={ref} className="w-full overflow-hidden py-2">
      <div className="h-[28px] w-full max-w-2xl mx-auto relative overflow-hidden transition-all duration-700">
        <Liveline
          data={data}
          value={currentRate}
          window={30}
          theme="dark"
          color={model.color}
          fill
          pulse
          exaggerate
          momentum={false}
          scrub={false}
          grid={false}
          badge={false}
          padding={{ top: 0, right: 8, bottom: 0, left: 8 }}
          className="!bg-transparent !border-none"
          style={{ border: "none" }}
        />
      </div>
    </div>
  );
}

// Mini MeterPill-style cost ticker for landing page
export function LiveMeterPill() {
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
export function LiveDebateTrace() {
  const [visibleTurns, setVisibleTurns] = useState(0);
  const [showSynthesis, setShowSynthesis] = useState(false);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });
  const cycleRef = useRef(0);

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

  const totalCycle = (turns.length * 1500) + 3500;

  useEffect(() => {
    if (!isInView) {
      setVisibleTurns(0);
      setShowSynthesis(false);
      return;
    }

    function runCycle() {
      cycleRef.current++;
      const cycle = cycleRef.current;
      setVisibleTurns(0);
      setShowSynthesis(false);

      const timers: ReturnType<typeof setTimeout>[] = [];
      // Start first turn immediately (no initial delay)
      setVisibleTurns(1);
      turns.slice(1).forEach((_, i) => {
        timers.push(setTimeout(() => {
          if (cycleRef.current === cycle) setVisibleTurns(i + 2);
        }, (i + 1) * 1500));
      });
      timers.push(setTimeout(() => {
        if (cycleRef.current === cycle) setShowSynthesis(true);
      }, turns.length * 1500));
      return timers;
    }

    let timers = runCycle();
    const loop = setInterval(() => {
      timers.forEach(clearTimeout);
      timers = runCycle();
    }, totalCycle);

    return () => {
      clearInterval(loop);
      timers.forEach(clearTimeout);
    };
  }, [isInView, turns, totalCycle]);

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

        {/* Debate turns — fixed height to prevent layout shift */}
        <div className="p-3 space-y-3">
          {turns.map((turn, i) => {
            const model = getModel(turn.model);
            const visible = i < visibleTurns;
            const isLatest = i === visibleTurns - 1 && !showSynthesis;
            return (
              <div
                key={`${turn.model}-${turn.phase}`}
                className={`text-[12px] transition-opacity duration-400 ${visible ? "opacity-100" : "opacity-0"}`}
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
                <p className="mt-1 italic leading-relaxed text-[11px] text-muted-foreground/70">
                  {turn.content}
                  {isLatest && (
                    <span className="inline-block w-1.5 h-3 bg-amber-500/50 ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            );
          })}

          <div
            className={`text-[12px] border-t border-amber-500/10 pt-3 transition-opacity duration-600 ${showSynthesis ? "opacity-100" : "opacity-0"}`}
          >
            <span className="font-mono text-[10px] text-amber-500/70">Synthesis</span>
            <p className="mt-1 text-[11px] text-foreground/60 leading-relaxed">
              Phased monorepo migration wins. Start with shared libraries, expand module boundaries after team stabilizes at 12. Trade-off: 2-week delay. Risk: low.
            </p>
            <p className="mt-2 font-mono text-[10px] text-emerald-500/60">Ready to lock as decision</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// Decision record card matching app inspector UI
export function LiveDecisionCard() {
  const [phase, setPhase] = useState<"draft" | "filling" | "locking" | "locked">("draft");
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  useEffect(() => {
    if (!isInView) {
      setPhase("draft");
      return;
    }

    function runCycle() {
      setPhase("draft");
      const timers = [
        setTimeout(() => setPhase("filling"), 1500),
        setTimeout(() => setPhase("locking"), 3500),
        setTimeout(() => setPhase("locked"), 4500),
      ];
      return timers;
    }

    let timers = runCycle();
    const loop = setInterval(() => {
      timers.forEach(clearTimeout);
      timers = runCycle();
    }, 7000);

    return () => {
      clearInterval(loop);
      timers.forEach(clearTimeout);
    };
  }, [isInView]);

  const filled = phase !== "draft";

  return (
    <div ref={ref} className="w-full max-w-[320px]">
      <div className="rounded-xl border border-foreground/[0.06] bg-background overflow-hidden">
        <div className="px-4 py-3 border-b border-foreground/[0.04] flex items-center justify-between">
          <span className="font-mono text-[11px] text-foreground/70">Decision #0047</span>
          <span
            className={`font-mono text-[10px] px-2 py-0.5 rounded-full transition-colors duration-300 ${
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
        {/* Always render full content; toggle visibility with opacity to prevent layout shift */}
        <div className="p-4 space-y-3">
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Context</div>
            <div className={`text-[12px] leading-relaxed transition-opacity duration-500 ${filled ? "text-foreground/60 opacity-100" : "opacity-20"}`}>
              Architecture decision for new dashboard service. Monorepo vs polyrepo.
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Choice</div>
            <div className={`text-[12px] font-medium transition-opacity duration-500 ${filled ? "text-foreground/70 opacity-100" : "opacity-20"}`}>
              Phased monorepo migration
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Trade-offs</div>
            <div className={`text-[11px] leading-relaxed transition-opacity duration-500 ${filled ? "text-muted-foreground/50 opacity-100" : "opacity-20"}`}>
              2-week delay to production. Lower coupling risk. Team ramp needed.
            </div>
          </div>
          <div>
            <div className="font-mono text-[9px] text-muted-foreground/30 uppercase tracking-wider mb-1">Dissent</div>
            <div className={`text-[11px] leading-relaxed transition-opacity duration-500 ${filled ? "text-muted-foreground/50 opacity-100" : "opacity-20"}`}>
              GPT-5.4 favored immediate full migration.
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Model grid matching actual model picker UI
export function LiveModelGrid() {
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
    <div ref={ref} className="w-[380px]">
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
              <div
                className="flex items-center gap-1 transition-opacity"
                style={{ opacity: i === activeIdx ? 1 : 0 }}
              >
                <span className="font-mono text-[9px] text-muted-foreground/40">routing</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500/50 animate-pulse" />
              </div>
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

function ModelLogosRow({ activeModelIdx }: { activeModelIdx: number }) {
  const displayModels = MODELS.filter((m) => m.id !== "auto");

  return (
    <div className="flex items-center justify-center gap-6 sm:gap-8 py-6 border-y border-foreground/[0.04]">
      {displayModels.map((m, i) => (
        <button
          key={m.id}
          className={`flex items-center gap-1.5 transition-all duration-500 ${
            i === activeModelIdx % displayModels.length
              ? "opacity-90"
              : "opacity-25 hover:opacity-50"
          }`}
        >
          <ModelLogo model={m} size={14} />
          <span className="font-mono text-[11px] text-muted-foreground/70 hidden sm:block">{m.name}</span>
        </button>
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
  footer,
}: {
  label: string;
  title: React.ReactNode;
  description: string | React.ReactNode;
  children: React.ReactNode;
  reverse?: boolean;
  delay?: number;
  footer?: React.ReactNode;
}) {
  return (
    <RevealSection className="relative z-10 py-24 sm:py-32 px-6" delay={delay}>
      <div className="max-w-5xl mx-auto">
        <div className={`grid grid-cols-1 lg:grid-cols-2 gap-12 lg:gap-20 items-start ${reverse ? "direction-rtl" : ""}`}>
          <div className={`lg:sticky lg:top-32 ${reverse ? "lg:order-2" : ""}`}>
            <div className="mb-4">
              <span className="inline-flex items-center px-3 py-1 rounded-full border border-foreground/[0.08] bg-foreground/[0.03] font-mono text-[11px] tracking-[0.15em] text-muted-foreground/60 uppercase">
                {label}
              </span>
            </div>
            <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
              {title}
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground/70 leading-relaxed">
              {description}
            </p>
            {footer}
          </div>
          <div className={`flex items-start justify-center p-6 sm:p-8 ${reverse ? "lg:order-1" : ""}`}>
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
      {error && (
        <p className="font-mono text-[11px] text-red-400">{error}</p>
      )}
      {status && !error && (
        <p className="font-mono text-[11px] text-muted-foreground/60">{status}</p>
      )}
      <button
        onClick={onCrossDevice}
        disabled={loading}
        className="w-full h-12 rounded-xl bg-foreground text-background text-sm font-medium transition-all hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2 hover:shadow-lg hover:shadow-foreground/5"
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {loading ? "Authenticating..." : "Sign in to start thinking"}
      </button>
      <button
        onClick={onCreateAccount}
        disabled={loading}
        className="w-full h-10 rounded-xl border border-foreground/[0.08] text-foreground text-sm font-medium transition-colors hover:bg-foreground/[0.03] active:bg-foreground/[0.05] disabled:opacity-50"
      >
        Create new account
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
          <span className="text-sm text-foreground/50">{logo.name}</span>
          <span className="font-mono text-xs text-foreground/35">{logo.price}</span>
        </motion.div>
      ))}
    </div>
  );
}

// ── Main Landing Page ──────────────────────────────────────────────────

export function LandingPage() {
  const { setAuth, setCardOnFile, fetchCards } = useMeterStore();
  const [step, setStep] = useState<AuthStep>("no-account");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.12], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.12], [1, 0.97]);

  // Cycle through models for hero liveline
  const [activeModelIdx, setActiveModelIdx] = useState(0);
  const displayModelsCount = MODELS.filter((m) => m.id !== "auto").length;
  useEffect(() => {
    const interval = setInterval(() => {
      setActiveModelIdx((i) => (i + 1) % displayModelsCount);
    }, 3000);
    return () => clearInterval(interval);
  }, [displayModelsCount]);

  // ── Auth handlers ──────────────────────────────────────────────────

  const afterPasskey = async (user: PendingUser, method?: string) => {
    const currentUserId = useMeterStore.getState().userId;
    if (currentUserId && currentUserId !== user.id) {
      await useMeterStore.getState().logout();
    }
    setAuth(user.id, user.handle ?? null, user.email ?? "", (user.accountType as "standard" | "superadmin") ?? "standard", user.markupMultiplier ?? DEFAULT_MARKUP_MULTIPLIER);
    identifyUser(user.id, { email: user.email, accountType: user.accountType ?? "standard", cardOnFile: user.cardOnFile });
    if (method === "register") {
      trackAccountCreated({ method: "passkey" });
    } else {
      trackUserLoggedIn({ method: method ?? "passkey" });
    }
    if (user.cardOnFile) {
      setCardOnFile(true, user.cardLast4 ?? undefined, user.cardBrand);
    }
    // Eagerly fetch cards from Stripe — covers cases where the webhook
    // didn't save card details to the DB but the card exists in Stripe.
    fetchCards();
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
      const optRes = await authFetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-options" }) });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");
      setStatus("Authenticating...");
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLStringToBuffer(optData.options.challenge),
          rpId: optData.options.rpId,
          timeout: 15000,
          userVerification: optData.options.userVerification ?? "preferred",
          allowCredentials: [],
          // @ts-expect-error -- hints is WebAuthn L3, not in TS DOM types yet
          hints: ["client-device"],
        },
      });
      if (!credential) { setStep("no-account"); setLoading(false); setStatus(null); return; }
      setStatus("Verifying...");
      const verifyRes = await authFetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-verify", challengeId: optData.challengeId, credential: credentialToJSON(credential as PublicKeyCredential) }) });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Login failed");
      afterPasskey(verifyData.user, "login");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.includes("NotAllowedError") || msg.includes("not allowed") || msg.includes("timed out") || msg.includes("The operation either timed out")) {
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
      const optRes = await authFetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "register-options" }) });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");
      const credential = await startRegistration({ optionsJSON: optData.options });
      setStatus("Verifying...");
      const verifyRes = await authFetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "register-verify", challengeId: optData.challengeId, credential, userId: optData.userId }) });
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
    setStatus("Authenticating...");
    trackCrossDeviceAuthStarted();
    try {
      const optRes = await authFetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-options" }) });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");
      const credential = await navigator.credentials.get({
        publicKey: { challenge: base64URLStringToBuffer(optData.options.challenge), rpId: optData.options.rpId, timeout: optData.options.timeout ?? 120000, userVerification: optData.options.userVerification ?? "preferred", allowCredentials: [] },
      });
      if (!credential) { setError("No credential received. Try again."); setLoading(false); setStatus(null); return; }
      setStatus("Verifying...");
      const verifyRes = await authFetch("/api/auth/passkey", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ step: "auth-verify", challengeId: optData.challengeId, credential: credentialToJSON(credential as PublicKeyCredential) }) });
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
      <header>
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
              className="font-mono text-[12px] text-muted-foreground/60 hover:text-foreground transition-colors tracking-wide hidden sm:block"
            >
              Docs
            </a>
            <button
              onClick={handleContinue}
              disabled={loading}
              className="h-8 px-4 rounded-lg bg-foreground/[0.06] border border-foreground/[0.06] text-foreground text-xs font-medium transition-all hover:bg-foreground/[0.1] hover:border-foreground/[0.12] disabled:opacity-50 flex items-center justify-center gap-1.5"
            >
              {loading && (
                <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? "Signing in..." : "Sign in"}
            </button>
          </div>
        </div>
      </nav>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────── */}
      <motion.section
        className="relative z-10 flex flex-col items-center justify-center px-6 pt-32 pb-12"
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
            <span className="font-mono text-[11px] tracking-[0.2em] text-muted-foreground/60 uppercase">
              Discuss ✜ Debate ✜ Decide
            </span>
          </motion.div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tighter leading-[0.95] mb-6">
            Pay-Per-Thought AI.
          </h1>

          <motion.p
            className="text-lg sm:text-xl text-muted-foreground/70 max-w-lg mx-auto leading-relaxed mb-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
          >
            Think freely, getting the top frontier models to debate each other, while keeping your thoughts private, and paying only for what you use.
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
        </motion.div>
      </motion.section>

      {/* ── Liveline + model selector below hero ───────────────────── */}
      <div className="relative z-10">
        <HeroLiveline activeModelIdx={activeModelIdx} />
      </div>
      <div className="relative z-10">
        <ModelLogosRow activeModelIdx={activeModelIdx} />
      </div>

      {/* ── The problem ────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[11px] tracking-[0.3em] text-muted-foreground/50 uppercase mb-8">
            The problem
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-6 leading-tight">
            Why pay hundreds a month for subscriptions you barely use?
          </h2>
          <div className="mb-8">
            <SubscriptionLogos />
          </div>
          <p className="text-base sm:text-lg text-muted-foreground/60 max-w-md mx-auto leading-relaxed">
            Execution has become easy. Cursor writes your code. Vercel ships it.
            The bottleneck is now the thinking that happens before the first commit.
          </p>
        </div>
      </RevealSection>

      {/* ── Pay-per-thought (with live meter pill) ──────────────── */}
      <FeatureSection
        label="Pay per thought"
        title={<>Pay per thought, not per month.<br /><span className="text-foreground/40">Intelligence metered like electricity.</span></>}
        description="Every response shows its cost as it streams. Pennies per thought, not $20/month for 5 messages worth of value. Pay only for what you use."
      >
        <LiveMeterPill />
      </FeatureSection>

      {/* ── Every frontier model (with live model grid) ───────────── */}
      <FeatureSection
        label="Every frontier model"
        title={<>Every frontier model.<br /><span className="text-foreground/40">Pay as you go billing.</span></>}
        description="Access Claude, GPT, Gemini, Grok, DeepSeek, and MiniMax on a single postpaid tab. Auto-routing selects the optimal model based on task complexity, cost, and availability."
        reverse
      >
        <LiveModelGrid />
      </FeatureSection>

      {/* ── Debate mode (with live debate trace) ────────────────── */}
      <FeatureSection
        label="Debate mode"
        title={<>Adversarial intelligence.<br /><span className="text-foreground/40">Multi-model debate for your hardest decisions.</span></>}
        description="Pit Claude against GPT against Gemini on your hardest strategic questions. Four-phase adversarial structure forces models to attack each other's logic. Opening, Challenge, Rebuttal, Synthesis."
      >
        <LiveDebateTrace />
      </FeatureSection>

      {/* ── Decision records (with live decision card) ──────────── */}
      <FeatureSection
        label="Decision records"
        title={<>When you have conviction,<br /><span className="text-foreground/40">log your decisions.</span></>}
        description="Decisions are structured records — not chat logs. Context, choice, trade-offs, and dissent. Timestamped and versioned. Your thinking becomes institutional memory."
        reverse
      >
        <LiveDecisionCard />
      </FeatureSection>

      {/* ── Secondary Features Grid ────────────────────────────── */}
      <FeatureBoxGrid />

      {/* ── Pricing ────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-3xl mx-auto text-center">
          <p className="font-mono text-[11px] tracking-[0.3em] text-muted-foreground/50 uppercase mb-4">
            Pricing
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
            Pay for what you think. Nothing else.
          </h2>
          <p className="text-base sm:text-lg text-muted-foreground/60 max-w-md mx-auto leading-relaxed mb-6">
            No seats. No tiers. No annual contracts. Use any model, pay per token.
            Set a hard cap so you never overspend.
          </p>
          <a
            href="/docs#pricing"
            className="font-mono text-[12px] text-muted-foreground/50 hover:text-foreground/70 transition-colors"
          >
            See pricing details &rarr;
          </a>
        </div>
      </RevealSection>

      {/* ── Closing quote ───────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-12 sm:py-16 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <blockquote className="text-lg sm:text-xl font-medium text-foreground/50 leading-snug tracking-tight italic">
            &ldquo;A brilliant codebase built on a broken decision is still a broken product.&rdquo;
          </blockquote>
        </div>
      </RevealSection>

      {/* ── Final CTA ─────────────────────────────────────────── */}
      <section className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <RevealSection>
            <p className="font-mono text-[11px] tracking-[0.3em] text-muted-foreground/50 uppercase mb-4">
              Public beta
            </p>
            <h2 className="text-3xl sm:text-4xl lg:text-5xl font-semibold tracking-tight mb-4">
              Start thinking.
            </h2>
            <p className="text-base sm:text-lg text-muted-foreground/60 mb-10 max-w-md mx-auto leading-relaxed">
              No subscription. No account to set up. Just a passkey
              and you&apos;re thinking. Pay only for what you use.
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
      <footer className="relative z-10 border-t border-foreground/[0.06] py-10 px-6">
        <div className="max-w-5xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-4">
            <Image
              src="/logo-dark-copy.webp"
              alt="Meter"
              width={72}
              height={20}
              className="hidden dark:block opacity-60"
            />
            <Image
              src="/logo-light.webp"
              alt="Meter"
              width={72}
              height={20}
              className="block dark:hidden opacity-60"
            />
            <span className="font-mono text-[12px] text-muted-foreground/40">
              ✜  Pay Per Thought
            </span>
          </div>

          <div className="flex items-center gap-6">
            <a href="/terms" className="font-mono text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
              Terms
            </a>
            <a href="/privacy" className="font-mono text-[12px] text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
              Privacy
            </a>
            <a href="https://github.com/meterchat/mcp" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
            <a href="https://x.com/meter_chat" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a href="mailto:contact@meter.chat" className="text-muted-foreground/40 hover:text-muted-foreground/70 transition-colors">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7"/></svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
