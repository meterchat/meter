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

// ── Animated ASCII Art Components ──────────────────────────────────────

// Meter counter ticking up like a gas meter
function AsciiMeterCounter() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  ┌─────────────────────┐ ",
        "  │  M E T E R          │ ",
        "  │                     │ ",
        "  │   $ 0 . 0 0 0       │ ",
        "  │   ▁▁▁▁▁▁▁▁▁        │ ",
        "  │                     │ ",
        "  └─────────────────────┘ ",
      ],
      [
        "  ┌─────────────────────┐ ",
        "  │  M E T E R          │ ",
        "  │                     │ ",
        "  │   $ 0 . 0 0 1       │ ",
        "  │   ▂▁▁▁▁▁▁▁▁        │ ",
        "  │   ◎ streaming...    │ ",
        "  └─────────────────────┘ ",
      ],
      [
        "  ┌─────────────────────┐ ",
        "  │  M E T E R          │ ",
        "  │                     │ ",
        "  │   $ 0 . 0 0 3       │ ",
        "  │   ▃▂▁▁▁▁▁▁▁        │ ",
        "  │   ◎ streaming...    │ ",
        "  └─────────────────────┘ ",
      ],
      [
        "  ┌─────────────────────┐ ",
        "  │  M E T E R          │ ",
        "  │                     │ ",
        "  │   $ 0 . 0 0 7       │ ",
        "  │   ▅▃▂▁▁▁▁▁▁        │ ",
        "  │   ◎ streaming...    │ ",
        "  └─────────────────────┘ ",
      ],
      [
        "  ┌─────────────────────┐ ",
        "  │  M E T E R          │ ",
        "  │                     │ ",
        "  │   $ 0 . 0 1 2       │ ",
        "  │   ▆▅▃▂▁▁▁▁▁        │ ",
        "  │   ◎ streaming...    │ ",
        "  └─────────────────────┘ ",
      ],
      [
        "  ┌─────────────────────┐ ",
        "  │  M E T E R          │ ",
        "  │                     │ ",
        "  │   $ 0 . 0 1 5       │ ",
        "  │   ▇▆▅▃▂▁▁▁▁        │ ",
        "  │   ✓ settled         │ ",
        "  └─────────────────────┘ ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 800);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i} className={frame === frames.length - 1 && i === 5 ? "text-emerald-500/50" : ""}>
          {line}
        </div>
      ))}
    </div>
  );
}

// Debate mode - models arguing back and forth
function AsciiDebateAnim() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  Claude ●───────────────── ",
        '  │ "Monorepo reduces      ',
        '  │  deploy complexity."    ',
        "  │                         ",
        "  GPT    ○                  ",
        "  Gemini ○                  ",
      ],
      [
        "  Claude ●                  ",
        "  │                         ",
        "  GPT    ●───────────────── ",
        '  │ "But coupling risk     ',
        '  │  rises with team size." ',
        "  Gemini ○                  ",
      ],
      [
        "  Claude ●                  ",
        "  GPT    ●                  ",
        "  │                         ",
        "  Gemini ●───────────────── ",
        '  │ "Both miss migration   ',
        '  │  cost. Phase it."       ',
      ],
      [
        "  ┌─── SYNTHESIS ────────── ",
        "  │                         ",
        "  │  Phased monorepo wins.  ",
        "  │  Trade-off: 2wk delay   ",
        "  │  Risk: low              ",
        "  └── ✓ ready to lock ───── ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 2000);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i} className={frame === 3 ? "text-amber-500/40" : ""}>{line}</div>
      ))}
    </div>
  );
}

// Decision locking animation
function AsciiDecisionLock() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  ╭────────────────────╮ ",
        "  │ Decision #0047     │ ",
        "  │                    │ ",
        "  │ Status: draft      │ ",
        "  │ Choice: ________   │ ",
        "  │                    │ ",
        "  ╰────────────────────╯ ",
      ],
      [
        "  ╭────────────────────╮ ",
        "  │ Decision #0047     │ ",
        "  │                    │ ",
        "  │ Status: draft      │ ",
        "  │ Choice: Monorepo   │ ",
        "  │ Trade-offs: 3      │ ",
        "  ╰────────────────────╯ ",
      ],
      [
        "  ╭────────────────────╮ ",
        "  │ Decision #0047     │ ",
        "  │                    │ ",
        "  │ Status: locking... │ ",
        "  │ Choice: Monorepo   │ ",
        "  │ Trade-offs: 3      │ ",
        "  ╰────────────────────╯ ",
      ],
      [
        "  ╭────────────────────╮ ",
        "  │ Decision #0047  ✓  │ ",
        "  │                    │ ",
        "  │ Status: locked     │ ",
        "  │ Choice: Monorepo   │ ",
        "  │ Trade-offs: 3      │ ",
        "  ╰────────────────────╯ ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 1500);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i} className={frame === 3 && (i === 1 || i === 3) ? "text-emerald-500/50" : ""}>{line}</div>
      ))}
    </div>
  );
}

// Settle animation
function AsciiSettleAnim() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  ┌───────────────────────┐ ",
        "  │ Pending    $2.47      │ ",
        "  │                       │ ",
        "  │  ┌─────────────────┐  │ ",
        "  │  │    Settle       │  │ ",
        "  │  └─────────────────┘  │ ",
        "  └───────────────────────┘ ",
      ],
      [
        "  ┌───────────────────────┐ ",
        "  │ Pending    $2.47      │ ",
        "  │                       │ ",
        "  │  ┌─────────────────┐  │ ",
        "  │  │  Settling...    │  │ ",
        "  │  └─────────────────┘  │ ",
        "  └───────────────────────┘ ",
      ],
      [
        "  ┌───────────────────────┐ ",
        "  │ Pending    $2.47      │ ",
        "  │                       │ ",
        "  │  ┌─────────────────┐  │ ",
        "  │  │  Settling ◐     │  │ ",
        "  │  └─────────────────┘  │ ",
        "  └───────────────────────┘ ",
      ],
      [
        "  ┌───────────────────────┐ ",
        "  │ Settled    $0.00      │ ",
        "  │                       │ ",
        "  │  ┌─────────────────┐  │ ",
        "  │  │  Settled ✓      │  │ ",
        "  │  └─────────────────┘  │ ",
        "  └───────────────────────┘ ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 1200);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i} className={frame === 3 ? "text-emerald-500/50" : ""}>{line}</div>
      ))}
    </div>
  );
}

// Fork path animation
function AsciiForkAnim() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  Main ─────────────────── ",
        "  │                        ",
        "  │  What stack to use?    ",
        "  │                        ",
        "  ·                        ",
        "  ·                        ",
      ],
      [
        "  Main ──────────┐         ",
        "  │               │         ",
        "  │           Path A        ",
        "  │           │ Next.js     ",
        "  │               │         ",
        "  ·           Path B        ",
      ],
      [
        "  Main ──────────┐         ",
        "  │               │         ",
        "  │           Path A        ",
        "  │           │ Next.js ✓   ",
        "  │               │         ",
        "  │           Path B        ",
        "  │           │ SvelteKit   ",
      ],
      [
        "  Main ◄─── merge ──┐      ",
        "  │                  │      ",
        "  │  Decided: Next.js│      ",
        "  │                  │      ",
        "  │            Path A ✓     ",
        "  │            Path B ✗     ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 1800);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i} className={
          frame === 3 && i === 2 ? "text-teal-500/50" :
          line.includes("Path A") ? "text-teal-500/30" :
          line.includes("Path B") ? "text-indigo-500/30" : ""
        }>{line}</div>
      ))}
    </div>
  );
}

// Blueprint/artifact generation animation
function AsciiBlueprintAnim() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  Generating spec kit...   ",
        "  │                        ",
        "  ├── README.md       ░    ",
        "  ├── ARCHITECTURE.md ░    ",
        "  ├── DESIGN.md       ░    ",
        "  ├── DECISIONS.md    ░    ",
        "  └── CLAUDE.md       ░    ",
      ],
      [
        "  Generating spec kit...   ",
        "  │                        ",
        "  ├── README.md       ▓    ",
        "  ├── ARCHITECTURE.md ▒    ",
        "  ├── DESIGN.md       ░    ",
        "  ├── DECISIONS.md    ░    ",
        "  └── CLAUDE.md       ░    ",
      ],
      [
        "  Generating spec kit...   ",
        "  │                        ",
        "  ├── README.md       █    ",
        "  ├── ARCHITECTURE.md █    ",
        "  ├── DESIGN.md       ▓    ",
        "  ├── DECISIONS.md    ▒    ",
        "  └── CLAUDE.md       ░    ",
      ],
      [
        "  Agent Spec Kit ready ✓   ",
        "  │                        ",
        "  ├── README.md       █    ",
        "  ├── ARCHITECTURE.md █    ",
        "  ├── DESIGN.md       █    ",
        "  ├── DECISIONS.md    █    ",
        "  └── CLAUDE.md       █    ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 1400);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i} className={frame === 3 && i === 0 ? "text-emerald-500/50" : ""}>{line}</div>
      ))}
    </div>
  );
}

// Spend monitor animation
function AsciiSpendMonitor() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "  ┌── Spend Monitor ──────┐",
        "  │                       │",
        "  │ Today      $0.42      │",
        "  │ This week  $3.17      │",
        "  │ Cap        $50.00     │",
        "  │                       │",
        "  │ ▁▂▃▂▁▂▃▅▃▂  usage    │",
        "  └───────────────────────┘",
      ],
      [
        "  ┌── Spend Monitor ──────┐",
        "  │                       │",
        "  │ Today      $0.48      │",
        "  │ This week  $3.23      │",
        "  │ Cap        $50.00     │",
        "  │                       │",
        "  │ ▂▃▂▁▂▃▅▃▂▃  usage    │",
        "  └───────────────────────┘",
      ],
      [
        "  ┌── Spend Monitor ──────┐",
        "  │                       │",
        "  │ Today      $0.51      │",
        "  │ This week  $3.26      │",
        "  │ Cap        $50.00     │",
        "  │                       │",
        "  │ ▃▂▁▂▃▅▃▂▃▄  usage    │",
        "  └───────────────────────┘",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 1000);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </div>
  );
}

// Model pills orbiting animation
function AsciiModelPills() {
  const [frame, setFrame] = useState(0);
  const ref = useRef(null);
  const isInView = useInView(ref, { once: false, margin: "-100px" });

  const frames = useMemo(
    () => [
      [
        "                             ",
        "       ╭─────────╮          ",
        "       │ Claude  │          ",
        "       ╰────┬────╯          ",
        "  ╭─────╮   │   ╭─────╮    ",
        "  │ GPT │───┼───│Grok │    ",
        "  ╰─────╯   │   ╰─────╯    ",
        "       ╭────┴────╮          ",
        "       │ Gemini  │          ",
        "       ╰─────────╯          ",
      ],
      [
        "                             ",
        "       ╭─────────╮          ",
        "       │ ●Claude │          ",
        "       ╰────┬────╯          ",
        "  ╭─────╮   │   ╭─────╮    ",
        "  │ GPT │───┼───│Grok │    ",
        "  ╰─────╯   │   ╰─────╯    ",
        "       ╭────┴────╮          ",
        "       │ Gemini  │          ",
        "       ╰─────────╯          ",
      ],
      [
        "                             ",
        "       ╭─────────╮          ",
        "       │ Claude  │          ",
        "       ╰────┬────╯          ",
        "  ╭─────╮   │   ╭─────╮    ",
        "  │●GPT │───┼───│Grok │    ",
        "  ╰─────╯   │   ╰─────╯    ",
        "       ╭────┴────╮          ",
        "       │ Gemini  │          ",
        "       ╰─────────╯          ",
      ],
      [
        "                             ",
        "       ╭─────────╮          ",
        "       │ Claude  │          ",
        "       ╰────┬────╯          ",
        "  ╭─────╮   │   ╭─────╮    ",
        "  │ GPT │───┼───│Grok │    ",
        "  ╰─────╯   │   ╰─────╯    ",
        "       ╭────┴────╮          ",
        "       │●Gemini  │          ",
        "       ╰─────────╯          ",
      ],
    ],
    []
  );

  useEffect(() => {
    if (!isInView) return;
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % frames.length);
    }, 700);
    return () => clearInterval(interval);
  }, [isInView, frames.length]);

  return (
    <div ref={ref} className="font-mono text-[11px] sm:text-[13px] leading-[1.4] text-foreground/30 whitespace-pre select-none">
      {frames[frame].map((line, i) => (
        <div key={i}>{line}</div>
      ))}
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

// ── Scrolling Ticker ───────────────────────────────────────────────────

function Ticker() {
  const items = [
    "PAY PER THOUGHT",
    "CLAUDE",
    "GPT",
    "GEMINI",
    "GROK",
    "DEEPSEEK",
    "NO SUBSCRIPTION",
    "STRUCTURED DEBATES",
    "DECISION RECORDS",
    "FORK PATHS",
    "AUTO-SETTLE",
    "MCP SERVER",
  ];

  return (
    <div className="relative overflow-hidden py-4 border-y border-foreground/[0.04]">
      <motion.div
        className="flex gap-12 whitespace-nowrap"
        animate={{ x: ["0%", "-50%"] }}
        transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
      >
        {[...items, ...items].map((item, i) => (
          <span
            key={i}
            className="font-mono text-[11px] tracking-[0.2em] text-foreground/20 uppercase"
          >
            {item}
          </span>
        ))}
      </motion.div>
    </div>
  );
}

// ── Feature Section (text + ASCII animation side by side) ─────────────

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
          <div className={`flex items-center justify-center p-6 sm:p-8 rounded-2xl border border-foreground/[0.04] bg-foreground/[0.015] ${reverse ? "lg:order-1" : ""}`}>
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

  // ── Auth handlers (preserved from login-screen.tsx) ──────────────

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
          <motion.div
            className="font-mono text-[10px] tracking-[0.4em] text-muted-foreground/30 uppercase mb-8"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.3, duration: 0.8 }}
          >
            The first pay-per-thought AI
          </motion.div>

          <h1 className="text-4xl sm:text-6xl lg:text-7xl font-semibold tracking-tighter leading-[0.95] mb-6">
            Pay per thought,
            <br />
            <span className="text-foreground/40">not per month.</span>
          </h1>

          <motion.p
            className="text-lg sm:text-xl text-muted-foreground/60 max-w-lg mx-auto leading-relaxed mb-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
          >
            What if intelligence were metered like electricity.
            Chat with the top AI models, debate your hardest decisions,
            and pay only for what you use.
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

      {/* ── Ticker ─────────────────────────────────────────────────── */}
      <div className="relative z-10">
        <Ticker />
      </div>

      {/* ── Why pay for subscriptions? ─────────────────────────────── */}
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
            Every unplanned decision to change code leads to more time and spend fixing things.
            Meter lets you think first, code later.
          </p>
        </div>
      </RevealSection>

      {/* ── Introducing Meter (with meter counter animation) ────── */}
      <FeatureSection
        label="Introducing Meter"
        title={<>The first pay-per-thought AI.<br /><span className="text-foreground/40">Think first, pay later.</span></>}
        description="Meter routes your prompts across every frontier model on a single postpaid tab. Watch your spend tick up in real time — pennies, not subscriptions. Auto-settle when you're ready."
      >
        <AsciiMeterCounter />
      </FeatureSection>

      {/* ── Chat with top models (with model pills animation) ────── */}
      <FeatureSection
        label="Every frontier model"
        title={<>Chat with the top AI models.<br /><span className="text-foreground/40">One interface.</span></>}
        description="Claude, GPT, Gemini, Grok, DeepSeek — all available in one place. Auto-routing picks the best model for each task. No rate limits. No switching tabs."
        reverse
      >
        <AsciiModelPills />
      </FeatureSection>

      {/* ── Debate mode (with debate animation) ────────────────── */}
      <FeatureSection
        label="Debate mode"
        title={<>Get them to debate your ideas<br /><span className="text-foreground/40">in real time.</span></>}
        description="Pit models against each other on your hardest questions. Four-phase adversarial structure forces real critique, not consensus. The synthesis is stronger than any single model."
      >
        <AsciiDebateAnim />
      </FeatureSection>

      {/* ── Decision log (with lock animation) ─────────────────── */}
      <FeatureSection
        label="Decision records"
        title={<>When you have conviction,<br /><span className="text-foreground/40">lock it with one tap.</span></>}
        description="Decisions are structured records — not chat logs. Context, choice, trade-offs, and dissent. Timestamped and versioned. Your thinking becomes institutional memory."
        reverse
      >
        <AsciiDecisionLock />
      </FeatureSection>

      {/* ── Fork paths (with fork animation) ───────────────────── */}
      <FeatureSection
        label="Fork conversations"
        title={<>Explore paths<br /><span className="text-foreground/40">before you commit.</span></>}
        description="Fork any conversation to explore multiple directions in parallel. Compare outcomes, merge the best path back. Think divergently without losing your place."
      >
        <AsciiForkAnim />
      </FeatureSection>

      {/* ── Auto-settle (with settle animation) ────────────────── */}
      <FeatureSection
        label="Auto-settle"
        title={<>Meter auto-settles your spend.<br /><span className="text-foreground/40">Think, don't bookkeep.</span></>}
        description="Your balance accumulates as you think. Set a cap, set auto-settle thresholds, or settle manually. Spend your time thinking, not rate-limiting."
        reverse
      >
        <AsciiSettleAnim />
      </FeatureSection>

      {/* ── Blueprints (with blueprint animation) ──────────────── */}
      <FeatureSection
        label="Agent Spec Kit"
        title={<>Generate blueprints<br /><span className="text-foreground/40">as shareable documents.</span></>}
        description="Turn your decisions into structured specs — README, ARCHITECTURE, DESIGN, DECISIONS, CLAUDE.md. Commit directly to GitHub so your coding agents start with perfect context."
      >
        <AsciiBlueprintAnim />
      </FeatureSection>

      {/* ── Spend monitor (with monitor animation) ─────────────── */}
      <FeatureSection
        label="Spend controls"
        title={<>Monitor your spend.<br /><span className="text-foreground/40">Set caps and limits.</span></>}
        description="Real-time usage dashboard. Set daily caps, monthly limits, per-transaction maximums. Full visibility into which models cost what. Never overspend."
        reverse
      >
        <AsciiSpendMonitor />
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
                Your AI coding agents get full context of your decisions and blueprints
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

      {/* ── Privacy ─────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-24 sm:py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
            Privacy
          </p>
          <h2 className="text-2xl sm:text-3xl lg:text-4xl font-semibold tracking-tight mb-4 leading-tight">
            Private and anonymized by default.
          </h2>
          <p className="text-base text-muted-foreground/50 max-w-md mx-auto leading-relaxed">
            Your thoughts stay your thoughts. Meter doesn&apos;t train on your data,
            doesn&apos;t sell your prompts, and anonymizes everything by default.
          </p>
        </div>
      </RevealSection>

      {/* ── Future vision ──────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-16 sm:py-24 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <blockquote className="text-xl sm:text-2xl font-medium text-foreground/60 leading-snug tracking-tight italic">
            &ldquo;In the future everyone will wonder why they ever paid to think like they do gym memberships.&rdquo;
          </blockquote>
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
