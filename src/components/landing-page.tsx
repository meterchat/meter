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

// ── ASCII Rain Background ──────────────────────────────────────────────

const ASCII_CHARS = "01$.<>{}()=+-*/&|~^%#@!?:;▓▒░█▄▀";

function AsciiRain() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    let w = window.innerWidth;
    let h = window.innerHeight * 3;

    canvas.width = w;
    canvas.height = h;

    const fontSize = 14;
    const cols = Math.floor(w / (fontSize * 0.6));
    const drops: number[] = new Array(cols).fill(0).map(() => Math.random() * -100);
    const speeds: number[] = new Array(cols).fill(0).map(() => 0.3 + Math.random() * 0.7);

    function draw() {
      ctx!.fillStyle = "rgba(26, 26, 26, 0.05)";
      ctx!.fillRect(0, 0, w, h);
      ctx!.font = `${fontSize}px "JetBrains Mono", monospace`;

      for (let i = 0; i < cols; i++) {
        const char = ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)];
        const x = i * fontSize * 0.6;
        const y = drops[i] * fontSize;

        // Gradient opacity based on position
        const alpha = 0.03 + Math.sin(drops[i] * 0.05) * 0.02;
        ctx!.fillStyle = `rgba(255, 255, 255, ${Math.max(0.01, alpha)})`;
        ctx!.fillText(char, x, y);

        drops[i] += speeds[i];
        if (drops[i] * fontSize > h && Math.random() > 0.98) {
          drops[i] = 0;
        }
      }

      animId = requestAnimationFrame(draw);
    }

    draw();

    const handleResize = () => {
      w = window.innerWidth;
      h = window.innerHeight * 3;
      canvas.width = w;
      canvas.height = h;
    };
    window.addEventListener("resize", handleResize);

    return () => {
      cancelAnimationFrame(animId);
      window.removeEventListener("resize", handleResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="fixed inset-0 pointer-events-none z-0"
      style={{ opacity: 0.6 }}
    />
  );
}

// ── Floating ASCII Glyphs ──────────────────────────────────────────────

const GLYPH_SETS = [
  ["┌──────────┐", "│ DECISION │", "│ LOCKED   │", "└──────────┘"],
  ["╔══════════╗", "║ $0.003   ║", "║ per msg  ║", "╚══════════╝"],
  ["┌──────┐", "│ GPT  │", "│ vs   │", "│Claude│", "└──────┘"],
  ["╭────────╮", "│debate: │", "│speed   │", "│vs cost │", "╰────────╯"],
  ["┌────────┐", "│thinking│", "│deeply..│", "└────────┘"],
  ["╔════════╗", "║ARTIFACT║", "║COMMITED║", "╚════════╝"],
];

function FloatingGlyph({ lines, delay, x, y, duration }: {
  lines: string[];
  delay: number;
  x: string;
  y: string;
  duration: number;
}) {
  return (
    <motion.div
      className="absolute font-mono text-[10px] leading-tight text-foreground/[0.04] whitespace-pre select-none pointer-events-none hidden lg:block"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, y: 20 }}
      animate={{
        opacity: [0, 0.6, 0.6, 0],
        y: [20, 0, -10, -30],
      }}
      transition={{
        duration,
        delay,
        repeat: Infinity,
        repeatDelay: delay * 0.5,
        ease: "easeInOut",
      }}
    >
      {lines.map((line, i) => (
        <div key={i}>{line}</div>
      ))}
    </motion.div>
  );
}

function FloatingGlyphs() {
  const glyphs = useMemo(() => [
    { lines: GLYPH_SETS[0], delay: 0, x: "5%", y: "15%", duration: 12 },
    { lines: GLYPH_SETS[1], delay: 2, x: "85%", y: "25%", duration: 14 },
    { lines: GLYPH_SETS[2], delay: 4, x: "10%", y: "45%", duration: 10 },
    { lines: GLYPH_SETS[3], delay: 1, x: "88%", y: "55%", duration: 13 },
    { lines: GLYPH_SETS[4], delay: 3, x: "3%", y: "75%", duration: 11 },
    { lines: GLYPH_SETS[5], delay: 5, x: "90%", y: "80%", duration: 15 },
    { lines: GLYPH_SETS[0], delay: 6, x: "15%", y: "90%", duration: 12 },
    { lines: GLYPH_SETS[1], delay: 3, x: "80%", y: "10%", duration: 14 },
  ], []);

  return (
    <div className="fixed inset-0 pointer-events-none z-[1] overflow-hidden">
      {glyphs.map((g, i) => (
        <FloatingGlyph key={i} {...g} />
      ))}
    </div>
  );
}

// ── Animated ASCII Border ──────────────────────────────────────────────

function AsciiBorder({ className }: { className?: string }) {
  const chars = "─═━┄┈╌";
  const [line, setLine] = useState("");

  useEffect(() => {
    const len = 60;
    const interval = setInterval(() => {
      setLine(
        Array.from({ length: len }, () =>
          chars[Math.floor(Math.random() * chars.length)]
        ).join("")
      );
    }, 150);
    return () => clearInterval(interval);
  }, [chars]);

  return (
    <div className={`font-mono text-[10px] text-foreground/[0.06] tracking-[0.3em] overflow-hidden text-center select-none ${className}`}>
      {line}
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

// ── Animated Counter ───────────────────────────────────────────────────

function AnimatedPrice({ value, prefix = "$" }: { value: string; prefix?: string }) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });
  const [display, setDisplay] = useState("0.000");

  useEffect(() => {
    if (!isInView) return;
    const target = parseFloat(value);
    const duration = 1200;
    const start = Date.now();

    const tick = () => {
      const elapsed = Date.now() - start;
      const progress = Math.min(elapsed / duration, 1);
      const eased = 1 - Math.pow(1 - progress, 3);
      setDisplay((target * eased).toFixed(3));
      if (progress < 1) requestAnimationFrame(tick);
    };
    tick();
  }, [isInView, value]);

  return (
    <span ref={ref} className="font-mono tabular-nums">
      {prefix}{display}
    </span>
  );
}

// ── Scrolling Ticker ───────────────────────────────────────────────────

function Ticker() {
  const items = [
    "CLAUDE OPUS 4.6",
    "GPT-5.4",
    "GEMINI 3.1 PRO",
    "GROK 4.1",
    "DEEPSEEK V3",
    "MINIMAX M2.5",
    "AUTO-ROUTING",
    "PAY PER TOKEN",
    "NO SUBSCRIPTION",
    "STRUCTURED DEBATES",
    "DECISION RECORDS",
    "GITHUB ARTIFACTS",
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

// ── Feature Card ───────────────────────────────────────────────────────

function FeatureCard({ number, title, description, ascii, delay = 0 }: {
  number: string;
  title: string;
  description: string;
  ascii: string[];
  delay?: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-60px" });

  return (
    <motion.div
      ref={ref}
      className="group relative p-8 rounded-2xl border border-foreground/[0.04] bg-foreground/[0.01] hover:bg-foreground/[0.02] hover:border-foreground/[0.08] transition-all duration-500"
      initial={{ opacity: 0, y: 30 }}
      animate={isInView ? { opacity: 1, y: 0 } : { opacity: 0, y: 30 }}
      transition={{ duration: 0.6, delay, ease: [0.25, 0.46, 0.45, 0.94] }}
    >
      <div className="absolute top-6 right-6 font-mono text-[10px] text-foreground/10 tracking-wider">
        {number}
      </div>
      <div className="font-mono text-[9px] leading-tight text-foreground/[0.08] mb-6 whitespace-pre select-none group-hover:text-foreground/[0.12] transition-colors duration-500">
        {ascii.map((line, i) => (
          <div key={i}>{line}</div>
        ))}
      </div>
      <h3 className="text-lg font-medium text-foreground mb-2 tracking-tight">
        {title}
      </h3>
      <p className="text-sm text-muted-foreground leading-relaxed">
        {description}
      </p>
    </motion.div>
  );
}

// ── Model Dot ──────────────────────────────────────────────────────────

function ModelDot({ name, provider, color, delay }: {
  name: string;
  provider: string;
  color: string;
  delay: number;
}) {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true });

  return (
    <motion.div
      ref={ref}
      className="flex items-center gap-3 group"
      initial={{ opacity: 0, x: -10 }}
      animate={isInView ? { opacity: 1, x: 0 } : { opacity: 0, x: -10 }}
      transition={{ duration: 0.5, delay }}
    >
      <motion.div
        className="w-2 h-2 rounded-full shrink-0"
        style={{ backgroundColor: color }}
        animate={{ opacity: [0.5, 1, 0.5] }}
        transition={{ duration: 3, repeat: Infinity, delay: delay * 2 }}
      />
      <div>
        <span className="text-sm text-foreground font-medium">{name}</span>
        <span className="text-xs text-muted-foreground/50 ml-2">{provider}</span>
      </div>
    </motion.div>
  );
}

// ── Debate Visualization ───────────────────────────────────────────────

function DebateViz() {
  const ref = useRef(null);
  const isInView = useInView(ref, { once: true, margin: "-100px" });

  const phases = ["OPENING", "CHALLENGE", "REBUTTAL", "SYNTHESIS"];

  return (
    <div ref={ref} className="relative">
      <div className="flex items-center justify-between gap-2 mb-6">
        {phases.map((phase, i) => (
          <motion.div
            key={phase}
            className="flex-1"
            initial={{ opacity: 0, scaleX: 0 }}
            animate={isInView ? { opacity: 1, scaleX: 1 } : {}}
            transition={{ duration: 0.5, delay: i * 0.15 }}
          >
            <div className="h-[2px] bg-foreground/[0.06] rounded-full mb-2 overflow-hidden">
              <motion.div
                className="h-full bg-foreground/20 rounded-full origin-left"
                initial={{ scaleX: 0 }}
                animate={isInView ? { scaleX: 1 } : {}}
                transition={{ duration: 0.8, delay: 0.5 + i * 0.2 }}
              />
            </div>
            <span className="font-mono text-[9px] tracking-[0.15em] text-foreground/20 uppercase">
              {phase}
            </span>
          </motion.div>
        ))}
      </div>

      <div className="space-y-3">
        {[
          { model: "Claude", color: "#D97757", text: "The monorepo approach reduces deployment complexity by 40% based on..." },
          { model: "GPT-5.4", color: "#10A37F", text: "However, the coupling risk increases significantly when team size exceeds..." },
          { model: "Grok", color: "#A0A0A0", text: "Both arguments miss the migration cost. A phased approach would..." },
        ].map((entry, i) => (
          <motion.div
            key={entry.model}
            className="flex items-start gap-3 p-3 rounded-lg bg-foreground/[0.015] border border-foreground/[0.03]"
            initial={{ opacity: 0, x: -20 }}
            animate={isInView ? { opacity: 1, x: 0 } : {}}
            transition={{ duration: 0.5, delay: 1 + i * 0.2 }}
          >
            <div
              className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
              style={{ backgroundColor: entry.color }}
            />
            <div>
              <span className="font-mono text-[10px] text-foreground/40 tracking-wider uppercase">
                {entry.model}
              </span>
              <p className="text-xs text-muted-foreground/60 mt-0.5 leading-relaxed">
                {entry.text}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </div>
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
      <div className="flex flex-col items-center gap-3 w-full max-w-xs">
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
          Learn more →
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
    <div className="flex flex-col items-center gap-3 w-full max-w-xs">
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

// ── Main Landing Page ──────────────────────────────────────────────────

export function LandingPage() {
  const { setAuth, setCardOnFile } = useMeterStore();
  const [step, setStep] = useState<AuthStep>("passkey");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: containerRef });
  const heroOpacity = useTransform(scrollYProgress, [0, 0.15], [1, 0]);
  const heroScale = useTransform(scrollYProgress, [0, 0.15], [1, 0.95]);

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
      <AsciiRain />
      <FloatingGlyphs />

      {/* ── Navigation ─────────────────────────────────────────────── */}
      <nav className="fixed top-0 left-0 right-0 z-50 px-6 py-5">
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
        className="relative z-10 min-h-screen flex flex-col items-center justify-center px-6"
        style={{ opacity: heroOpacity, scale: heroScale }}
      >
        <motion.div
          className="text-center max-w-3xl mx-auto"
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
            Every model. One bill. No subscription.
          </motion.div>

          <h1 className="text-5xl sm:text-7xl lg:text-8xl font-semibold tracking-tighter leading-[0.9] mb-6">
            <span className="block">Think in</span>
            <span className="block text-foreground/40">Meter.</span>
          </h1>

          <motion.p
            className="text-lg sm:text-xl text-muted-foreground/60 max-w-md mx-auto leading-relaxed mb-10"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 0.5, duration: 0.8 }}
          >
            The pay-per-thought AI that routes across frontier models,
            runs structured debates, and commits decisions to your codebase.
          </motion.p>

          <motion.div
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
            className="font-mono text-[10px] text-muted-foreground/20 mt-6 tracking-wide"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ delay: 1, duration: 0.8 }}
          >
            Passkey authentication. No passwords, ever.
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

      {/* ── Problem Statement ──────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-8">
            The thesis
          </p>
          <blockquote className="text-2xl sm:text-3xl font-medium text-foreground/80 leading-snug tracking-tight">
            &ldquo;A brilliant codebase built on a broken decision is still a broken product.&rdquo;
          </blockquote>
          <p className="text-base text-muted-foreground/40 mt-6 max-w-lg mx-auto leading-relaxed">
            Execution has become easy. Cursor writes your code. Vercel ships it.
            The bottleneck is now the thinking that happens before the first commit.
          </p>
        </div>
      </RevealSection>

      <AsciiBorder className="relative z-10 max-w-4xl mx-auto" />

      {/* ── Core Features ─────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6">
        <div className="max-w-5xl mx-auto">
          <div className="text-center mb-16">
            <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
              What Meter does
            </p>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Three layers of intelligence
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <FeatureCard
              number="01"
              title="Route"
              description="Every frontier model on one postpaid tab. Auto-routing picks the optimal model for each task. No rate limits — Meter routes around them."
              ascii={[
                "  ┌─────┐",
                "  │ IN  │──→ Claude",
                "  │     │──→ GPT",
                "  │ ··· │──→ Gemini",
                "  └─────┘──→ Grok",
              ]}
              delay={0}
            />
            <FeatureCard
              number="02"
              title="Debate"
              description="Force models into adversarial positions. Each critiques the other's strongest argument. Get a synthesis with trade-offs and a recommended path."
              ascii={[
                "  Claude ◆──┐",
                "  GPT   ◆──┤ CLASH",
                "  Grok  ◆──┘",
                "       ↓",
                "   [SYNTHESIS]",
              ]}
              delay={0.1}
            />
            <FeatureCard
              number="03"
              title="Record"
              description="Lock decisions as structured records — not chat logs. Context, choice, trade-offs, dissent. Auto-commit to GitHub as an Agent Spec Kit."
              ascii={[
                "  ┌──────────┐",
                "  │ DECISION │",
                "  │ #0047    │",
                "  │ locked ✓ │",
                "  └──────────┘",
              ]}
              delay={0.2}
            />
          </div>
        </div>
      </RevealSection>

      {/* ── Debate Deep Dive ──────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
                Debate mode
              </p>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
                Adversarial<br />intelligence
              </h2>
              <p className="text-base text-muted-foreground/60 leading-relaxed mb-6">
                Pit Claude against GPT against Gemini on your hardest
                strategic questions. Four-phase adversarial structure forces
                models to attack each other&apos;s logic. The result is a
                synthesis no single model could produce alone.
              </p>
              <div className="font-mono text-[10px] text-muted-foreground/25 space-y-1">
                <div>Opening → Each model states position</div>
                <div>Challenge → Attack strongest argument</div>
                <div>Rebuttal → Defend under fire</div>
                <div>Synthesis → Trade-offs + recommendation</div>
              </div>
            </div>
            <div className="bg-foreground/[0.015] border border-foreground/[0.04] rounded-2xl p-6">
              <DebateViz />
            </div>
          </div>
        </div>
      </RevealSection>

      <AsciiBorder className="relative z-10 max-w-4xl mx-auto" />

      {/* ── Models ────────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-start">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
                Models
              </p>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
                Every frontier model.
                <br />
                <span className="text-foreground/40">One bill.</span>
              </h2>
              <p className="text-base text-muted-foreground/60 leading-relaxed mb-8">
                Access Claude, GPT, Gemini, Grok, DeepSeek, and MiniMax on
                a single postpaid tab. Auto-routing selects the optimal model
                based on task complexity, cost, and availability.
              </p>
              <div className="flex items-baseline gap-2">
                <span className="text-4xl font-semibold tracking-tight">
                  <AnimatedPrice value="0.003" />
                </span>
                <span className="font-mono text-xs text-muted-foreground/40">
                  avg per thought
                </span>
              </div>
            </div>

            <div className="space-y-4 pt-2">
              {[
                { name: "Claude Opus 4.6", provider: "Anthropic", color: "#D97757" },
                { name: "Claude Sonnet 4.6", provider: "Anthropic", color: "#D97757" },
                { name: "GPT-5.4", provider: "OpenAI", color: "#10A37F" },
                { name: "Gemini 3.1 Pro", provider: "Google", color: "#4285F4" },
                { name: "Grok 4.1 Fast", provider: "xAI", color: "#A0A0A0" },
                { name: "DeepSeek V3", provider: "DeepSeek", color: "#4D6BFE" },
                { name: "MiniMax M2.5", provider: "MiniMax", color: "#E84142" },
              ].map((model, i) => (
                <ModelDot key={model.name} {...model} delay={i * 0.08} />
              ))}
              <div className="pt-3 border-t border-foreground/[0.04]">
                <ModelDot name="Auto" provider="Meter routes for you" color="#E4E4E7" delay={0.7} />
              </div>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ── How It Works ──────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6 bg-foreground/[0.01]">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
              How it works
            </p>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight">
              Think. Decide. Ship.
            </h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {[
              {
                step: "01",
                title: "Ask anything",
                desc: "Chat with any model, or trigger a multi-model debate on your toughest questions. Every response shows its cost in real time.",
                ascii: "$ _",
              },
              {
                step: "02",
                title: "Lock the decision",
                desc: "Convert debate outputs into structured decision records. Context, choice, trade-offs, and dissent — timestamped and versioned.",
                ascii: "✓ □",
              },
              {
                step: "03",
                title: "Commit to GitHub",
                desc: "One click deploys your Agent Spec Kit — CLAUDE.md, ARCHITECTURE.md, DECISIONS.md — so coding agents start with perfect context.",
                ascii: "→ ◆",
              },
            ].map((item, i) => (
              <RevealSection key={item.step} delay={i * 0.1}>
                <div className="text-center">
                  <div className="inline-flex items-center justify-center w-12 h-12 rounded-xl bg-foreground/[0.03] border border-foreground/[0.04] mb-4">
                    <span className="font-mono text-lg text-foreground/20">{item.ascii}</span>
                  </div>
                  <div className="font-mono text-[10px] text-muted-foreground/25 tracking-[0.2em] uppercase mb-2">
                    Step {item.step}
                  </div>
                  <h3 className="text-lg font-medium mb-2">{item.title}</h3>
                  <p className="text-sm text-muted-foreground/50 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ── Pricing ───────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
            Pricing
          </p>
          <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
            Pay for what you think.
            <br />
            <span className="text-foreground/40">Nothing else.</span>
          </h2>
          <p className="text-base text-muted-foreground/50 leading-relaxed mb-10 max-w-lg mx-auto">
            No seats. No tiers. No annual contracts. Use any model, pay per token
            at the end of the month. Set a hard cap so you never overspend.
          </p>

          <div className="inline-flex flex-col items-center gap-1 p-6 rounded-2xl border border-foreground/[0.04] bg-foreground/[0.01]">
            <span className="font-mono text-[10px] text-muted-foreground/30 tracking-[0.2em] uppercase">
              Starting from
            </span>
            <div className="flex items-baseline gap-1">
              <span className="text-5xl font-semibold tracking-tight">$0</span>
              <span className="text-lg text-muted-foreground/40">/mo</span>
            </div>
            <span className="font-mono text-[11px] text-muted-foreground/30 mt-1">
              + tokens consumed
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 mt-12 text-center">
            {[
              { label: "No subscription", icon: "∅" },
              { label: "Postpaid billing", icon: "◉" },
              { label: "Hard wallet cap", icon: "▣" },
              { label: "Monthly invoices", icon: "□" },
            ].map((item) => (
              <div key={item.label} className="p-3">
                <div className="font-mono text-lg text-foreground/15 mb-1">{item.icon}</div>
                <span className="font-mono text-[10px] text-muted-foreground/40 tracking-wide">
                  {item.label}
                </span>
              </div>
            ))}
          </div>
        </div>
      </RevealSection>

      <AsciiBorder className="relative z-10 max-w-4xl mx-auto" />

      {/* ── Connectors ────────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="text-center mb-16">
            <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
              Connectors
            </p>
            <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
              Three modes. Every tool.
            </h2>
            <p className="text-base text-muted-foreground/50 max-w-lg mx-auto leading-relaxed">
              Meter connects to the services you already use. Each mode surfaces
              the right data for the right decisions.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {[
              {
                mode: "Planner",
                desc: "Gmail, Linear, Calendar — decisions, follow-ups, strategy artifacts",
                ascii: ["┌───────┐", "│PLAN   │", "│→ □ □  │", "│→ ■ □  │", "└───────┘"],
              },
              {
                mode: "Coder",
                desc: "GitHub, Vercel, Porkbun — commits, PRs, deploys, domains",
                ascii: ["┌───────┐", "│CODE   │", "│ git + │", "│ ship  │", "└───────┘"],
              },
              {
                mode: "Banker",
                desc: "Stripe, Mercury, Puzzle, Gusto — runway, burn, revenue",
                ascii: ["┌───────┐", "│BANK   │", "│ $$$   │", "│ ↗↗↗   │", "└───────┘"],
              },
            ].map((item, i) => (
              <RevealSection key={item.mode} delay={i * 0.1}>
                <div className="p-6 rounded-2xl border border-foreground/[0.04] bg-foreground/[0.01] hover:border-foreground/[0.08] transition-colors">
                  <div className="font-mono text-[9px] leading-tight text-foreground/[0.08] mb-4 whitespace-pre">
                    {item.ascii.map((line, j) => (
                      <div key={j}>{line}</div>
                    ))}
                  </div>
                  <h3 className="text-base font-medium mb-1">{item.mode}</h3>
                  <p className="text-sm text-muted-foreground/50 leading-relaxed">
                    {item.desc}
                  </p>
                </div>
              </RevealSection>
            ))}
          </div>
        </div>
      </RevealSection>

      {/* ── SDK Section ───────────────────────────────────────────── */}
      <RevealSection className="relative z-10 py-32 px-6 bg-foreground/[0.01]">
        <div className="max-w-4xl mx-auto">
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-16 items-center">
            <div>
              <p className="font-mono text-[10px] tracking-[0.3em] text-muted-foreground/30 uppercase mb-4">
                For developers
              </p>
              <h2 className="text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
                Embed metered AI<br />
                <span className="text-foreground/40">in your product.</span>
              </h2>
              <p className="text-base text-muted-foreground/60 leading-relaxed">
                Drop in the React SDK or use the headless API.
                Every token your users consume flows through Meter.
                You set the markup. We handle billing, routing, and rate limits.
              </p>
            </div>

            <div className="rounded-2xl border border-foreground/[0.06] bg-foreground/[0.02] p-5 font-mono text-[12px] leading-relaxed overflow-x-auto">
              <div className="text-muted-foreground/30 mb-1">{"// npm i @meterxyz/react"}</div>
              <div>
                <span className="text-foreground/40">import</span>{" "}
                <span className="text-foreground/60">{"{ MeterChat }"}</span>{" "}
                <span className="text-foreground/40">from</span>{" "}
                <span className="text-foreground/50">{`'@meterxyz/react'`}</span>
              </div>
              <div className="mt-3 text-muted-foreground/30">{"// That's it. Metered AI in your app."}</div>
              <div className="mt-1">
                <span className="text-foreground/50">{"<MeterChat"}</span>
              </div>
              <div className="pl-4">
                <span className="text-foreground/40">apiKey</span>
                <span className="text-foreground/30">=</span>
                <span className="text-foreground/50">{`"mk_..."`}</span>
              </div>
              <div className="pl-4">
                <span className="text-foreground/40">models</span>
                <span className="text-foreground/30">=</span>
                <span className="text-foreground/50">{`{['auto']}`}</span>
              </div>
              <div>
                <span className="text-foreground/50">{"/>"}</span>
              </div>
            </div>
          </div>
        </div>
      </RevealSection>

      {/* ── Final CTA ─────────────────────────────────────────────── */}
      <section className="relative z-10 py-32 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <RevealSection>
            <h2 className="text-4xl sm:text-5xl font-semibold tracking-tight mb-4">
              Start thinking.
            </h2>
            <p className="text-base text-muted-foreground/50 mb-10 max-w-md mx-auto leading-relaxed">
              No credit card required. No subscription. Just open Meter
              and think. Pay for what you use at the end of the month.
            </p>
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
          </RevealSection>
        </div>
      </section>

      {/* ── Footer ────────────────────────────────────────────────── */}
      <footer className="relative z-10 border-t border-foreground/[0.04] py-8 px-6">
        <div className="max-w-5xl mx-auto flex items-center justify-between">
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
