"use client";

import Image from "next/image";
import { useState, useEffect, useRef, useCallback } from "react";
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

type OnboardingStep = "passkey" | "no-account";

interface PendingUser {
  id: string;
  email: string | null;
  cardOnFile: boolean;
  cardLast4: string | null;
  cardBrand?: string;
  gmailConnected: boolean;
  accountType?: string;
  markupMultiplier?: number;
  hasWorkspaces?: boolean;
}

// ── Convert raw PublicKeyCredential to JSON format for server ─────────
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

// ── Inline video player ─────────────────────────────────────────────────
function VideoPlayer() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);

  const toggle = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) { v.play(); setPlaying(true); }
    else { v.pause(); setPlaying(false); }
  }, []);

  return (
    <div
      className="relative rounded-2xl overflow-hidden border border-border/40 bg-black cursor-pointer group"
      onClick={toggle}
    >
      <video
        ref={videoRef}
        src="/meter.mp4"
        className="w-full block"
        playsInline
        preload="metadata"
        onEnded={() => setPlaying(false)}
      />
      {/* Play button overlay */}
      <div
        className={`absolute inset-0 flex items-center justify-center transition-opacity duration-300 ${
          playing ? "opacity-0 pointer-events-none group-hover:opacity-100" : "opacity-100"
        }`}
      >
        <div className="w-16 h-16 rounded-full bg-white/10 backdrop-blur-sm border border-white/20 flex items-center justify-center transition-transform hover:scale-110">
          {playing ? (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><rect x="6" y="4" width="4" height="16" rx="1" /><rect x="14" y="4" width="4" height="16" rx="1" /></svg>
          ) : (
            <svg width="22" height="22" viewBox="0 0 24 24" fill="white"><polygon points="8,5 19,12 8,19" /></svg>
          )}
        </div>
      </div>
    </div>
  );
}

// ── ASCII art canvas with animated thought stream ───────────────────────
const ASCII_CHARS = "01$.<>{}()=+-*/&|~^%#@!?:;";

function AsciiCanvas({ side }: { side: "left" | "right" }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let animId: number;
    const cols = 28;
    const fontSize = 14;
    const rows = 60;

    canvas.width = cols * fontSize * 0.65;
    canvas.height = rows * fontSize;

    // Each column has a "drop" that falls and leaves fading characters
    const drops: number[] = Array.from({ length: cols }, () => Math.random() * -rows);
    const speeds: number[] = Array.from({ length: cols }, () => 0.3 + Math.random() * 0.7);
    // Grid of character opacity (0..1) and character
    const grid: { char: string; opacity: number }[][] = Array.from(
      { length: rows },
      () => Array.from({ length: cols }, () => ({ char: " ", opacity: 0 }))
    );

    function draw() {
      ctx!.clearRect(0, 0, canvas!.width, canvas!.height);
      ctx!.font = `${fontSize}px "JetBrains Mono", monospace`;

      // Update drops
      for (let c = 0; c < cols; c++) {
        drops[c] += speeds[c];
        const row = Math.floor(drops[c]);
        if (row >= 0 && row < rows) {
          grid[row][c] = {
            char: ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)],
            opacity: 0.6,
          };
        }
        if (drops[c] > rows + Math.random() * rows) {
          drops[c] = Math.random() * -20;
          speeds[c] = 0.3 + Math.random() * 0.7;
        }
      }

      // Draw & fade
      for (let r = 0; r < rows; r++) {
        for (let c = 0; c < cols; c++) {
          const cell = grid[r][c];
          if (cell.opacity > 0.01) {
            // Occasionally flicker a nearby character to create "thought" effect
            if (Math.random() < 0.005) {
              cell.char = ASCII_CHARS[Math.floor(Math.random() * ASCII_CHARS.length)];
            }
            ctx!.fillStyle = `rgba(255,255,255,${cell.opacity * 0.15})`;
            ctx!.fillText(cell.char, c * fontSize * 0.65, r * fontSize);
            cell.opacity *= 0.985; // slow fade
          }
        }
      }

      animId = requestAnimationFrame(draw);
    }

    draw();
    return () => cancelAnimationFrame(animId);
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className={`fixed top-0 ${side === "left" ? "left-0" : "right-0"} pointer-events-none z-0 hidden lg:block`}
      style={{ opacity: 0.7 }}
    />
  );
}

// ── Main LoginScreen ────────────────────────────────────────────────────
export function LoginScreen() {
  const { setAuth, setCardOnFile } = useMeterStore();

  const [step, setStep] = useState<OnboardingStep>("passkey");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Passkey: Try platform authenticator first ─────────────────────
  const handleContinue = async () => {
    setLoading(true);
    setError(null);
    setStatus("Checking for passkey...");

    try {
      // Pre-check: does this device have a platform authenticator at all?
      // If not, skip WebAuthn entirely — no dialog, no QR code.
      if (
        typeof PublicKeyCredential === "undefined" ||
        !(await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable())
      ) {
        setStep("no-account");
        setLoading(false);
        setStatus(null);
        return;
      }

      // 1. Get auth options from server (no email, no allowCredentials)
      const optRes = await fetch(apiUrl("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "auth-options" }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

      // 2. Platform-only credential request.
      //    hints: ["client-device"] prevents QR code / cross-device modal.
      //    Empty allowCredentials → browser uses discoverable credentials:
      //      - 1 passkey  → straight to Face ID / Touch ID
      //      - N passkeys → account picker then biometric
      //      - 0 passkeys → throws NotAllowedError (caught below)
      setStatus("Authenticating...");
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLStringToBuffer(optData.options.challenge),
          rpId: optData.options.rpId,
          timeout: 15000,
          userVerification: optData.options.userVerification ?? "preferred",
          allowCredentials: [],
        },
        // @ts-expect-error -- hints is WebAuthn L3, not in TS DOM types yet
        hints: ["client-device"],
      });

      if (!credential) {
        // No credential available — show fallback UI
        setStep("no-account");
        setLoading(false);
        setStatus(null);
        return;
      }

      // 3. Verify with server
      setStatus("Verifying...");
      const verifyRes = await fetch(apiUrl("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "auth-verify",
          challengeId: optData.challengeId,
          credential: credentialToJSON(credential as PublicKeyCredential),
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Login failed");

      afterPasskey(verifyData.user, "login");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";

      // NotAllowedError / AbortError = no passkey on this device, or user cancelled
      // Go straight to fallback — no error shown, no QR code
      if (
        msg.includes("NotAllowedError") ||
        msg.includes("not allowed") ||
        msg.includes("AbortError") ||
        msg.includes("timed out") ||
        msg.includes("The operation either timed out")
      ) {
        setStep("no-account");
        setLoading(false);
        setStatus(null);
        return;
      }

      if (msg.includes("user could not be verified") || msg.includes("User verification")) {
        setError("Device verification failed. Make sure Face ID, Touch ID, or a PIN is set up.");
        trackLoginFailed({ method: "passkey", error: "device_verification_failed" });
      } else {
        setError(msg);
        trackLoginFailed({ method: "passkey", error: msg });
      }
      setLoading(false);
      setStatus(null);
    }
  };

  // ── Create new account ────────────────────────────────────────────
  const handleCreateAccount = async () => {
    setLoading(true);
    setError(null);
    setStatus("Setting up passkey...");

    try {
      const optRes = await fetch(apiUrl("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "register-options" }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

      const credential = await startRegistration({ optionsJSON: optData.options });

      setStatus("Verifying...");
      const verifyRes = await fetch(apiUrl("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "register-verify",
          challengeId: optData.challengeId,
          credential,
          userId: optData.userId,
        }),
      });
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
      } else {
        setError(msg);
        trackLoginFailed({ method: "passkey_register", error: msg });
      }
      setLoading(false);
      setStatus(null);
    }
  };

  // ── Sign in from another device (allows QR code) ──────────────────
  const handleCrossDevice = async () => {
    setLoading(true);
    setError(null);
    setStatus("Waiting for cross-device authentication...");
    trackCrossDeviceAuthStarted();

    try {
      const optRes = await fetch(apiUrl("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "auth-options" }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

      // Call WITHOUT hints restriction — allows cross-device (QR code)
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLStringToBuffer(optData.options.challenge),
          rpId: optData.options.rpId,
          timeout: optData.options.timeout ?? 120000,
          userVerification: optData.options.userVerification ?? "preferred",
          allowCredentials: [],
        },
      });

      if (!credential) {
        setError("No credential received. Try again.");
        setLoading(false);
        setStatus(null);
        return;
      }

      setStatus("Verifying...");
      const verifyRes = await fetch(apiUrl("/api/auth/passkey"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          step: "auth-verify",
          challengeId: optData.challengeId,
          credential: credentialToJSON(credential as PublicKeyCredential),
        }),
      });
      const verifyData = await verifyRes.json();
      if (!verifyRes.ok) throw new Error(verifyData.error || "Login failed");

      afterPasskey(verifyData.user, "cross_device");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      if (msg.includes("timed out") || msg.includes("not allowed") || msg.includes("AbortError") || msg.includes("NotAllowedError")) {
        setError("Authentication was cancelled. Try again.");
        trackLoginFailed({ method: "cross_device", error: "cancelled" });
      } else {
        setError(msg);
        trackLoginFailed({ method: "cross_device", error: msg });
      }
      setLoading(false);
      setStatus(null);
    }
  };

  // ── After successful passkey ──────────────────────────────────────
  const afterPasskey = async (user: PendingUser, method?: string) => {
    // Defensive: clear stale data if a different user was previously logged in
    const currentUserId = useMeterStore.getState().userId;
    if (currentUserId && currentUserId !== user.id) {
      await useMeterStore.getState().logout();
    }

    setAuth(user.id, user.email ?? "", (user.accountType as "standard" | "superadmin") ?? "standard", user.markupMultiplier ?? 1);

    identifyUser(user.id, {
      email: user.email,
      accountType: user.accountType ?? "standard",
      cardOnFile: user.cardOnFile,
    });
    if (method === "register") {
      trackAccountCreated({ method: "passkey" });
    } else {
      trackUserLoggedIn({ method: method ?? "passkey" });
    }

    // If user already has a card, set it so workspace is immediately ready
    if (user.cardOnFile) {
      setCardOnFile(true, user.cardLast4 ?? undefined, user.cardBrand);
    }
    // Auth set → page.tsx renders ChatView; onboarding handled in-chat
  };

  return (
    <div className="relative flex min-h-screen flex-col items-center bg-background px-4 overflow-y-auto overflow-x-hidden">
      {/* ── ASCII art canvases ── */}
      <AsciiCanvas side="left" />
      <AsciiCanvas side="right" />

      <div className="relative z-10 flex flex-col items-center gap-6 max-w-sm text-center mt-[10vh]">
        {/* Logo — always visible */}
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/logo-dark-copy.webp"
            alt="Meter"
            width={108}
            height={29}
            priority
            className="hidden dark:block"
          />
          <Image
            src="/logo-light.webp"
            alt="Meter"
            width={108}
            height={29}
            className="block dark:hidden"
          />
          <p className="font-mono text-xs text-muted-foreground tracking-wide uppercase">
            pay per thought
          </p>
        </div>

        {/* ── Passkey step (initial) ─────────────────────────────── */}
        {step === "passkey" && (
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Every model. One bill. No subscription.
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              The meter runs in dollars. You pay what you use.
            </p>

            {error && (
              <p className="font-mono text-[11px] text-red-400">{error}</p>
            )}

            {status && !error && (
              <p className="font-mono text-[11px] text-muted-foreground/60">{status}</p>
            )}

            <button
              onClick={handleContinue}
              disabled={loading}
              className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              {loading && (
                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
              )}
              {loading ? "Authenticating..." : "Continue"}
            </button>

            <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
              Sign in with passkey. No passwords, ever.
            </p>
          </div>
        )}

        {/* ── No account step (fallback after platform check) ────── */}
        {step === "no-account" && (
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-sm text-muted-foreground leading-relaxed">
              No account found on this device
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              Create a new account or sign in from a device where you&apos;re already set up.
            </p>

            {error && (
              <p className="font-mono text-[11px] text-red-400">{error}</p>
            )}

            {status && !error && (
              <p className="font-mono text-[11px] text-muted-foreground/60">{status}</p>
            )}

            <button
              onClick={handleCreateAccount}
              disabled={loading}
              className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2"
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
              onClick={handleCrossDevice}
              disabled={loading}
              className="w-full h-10 rounded-lg border border-border text-foreground text-sm font-medium transition-colors hover:bg-foreground/5 active:bg-foreground/10 disabled:opacity-50"
            >
              Sign in from another device
            </button>

            <button
              onClick={() => { setStep("passkey"); setError(null); setStatus(null); }}
              className="font-mono text-[10px] text-muted-foreground/40 hover:text-muted-foreground transition-colors"
            >
              Back
            </button>
          </div>
        )}
      </div>

      {/* ── Demo video ── */}
      <div className="relative z-10 w-full max-w-3xl mt-12 mb-32 px-4">
        <VideoPlayer />
      </div>

      {/* Footer — always visible */}
      <div className="fixed bottom-8 z-20 flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <a href="https://x.com/meterchat" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://github.com/meterchat/meter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
        </div>
        <div className="flex items-center gap-2 font-mono text-[10px] text-muted-foreground/30">
          <a href="/privacy" className="hover:text-muted-foreground/60 transition-colors">Privacy</a>
          <span>&middot;</span>
          <a href="/terms" className="hover:text-muted-foreground/60 transition-colors">Terms</a>
        </div>
      </div>
    </div>
  );
}
