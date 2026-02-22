"use client";

import Image from "next/image";
import { useState } from "react";
import { useMeterStore } from "@/lib/store";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

export function LoginScreen() {
  const { setAuth, setCardOnFile, connectService } = useMeterStore();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleContinue = async () => {
    const trimmed = email.trim();
    if (!trimmed) return;
    setLoading(true);
    setError(null);
    setStatus(null);

    try {
      // Step 1: Check if account exists
      setStatus("Looking up account...");
      const checkRes = await fetch("/api/auth/check", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: trimmed }),
      });
      const checkData = await checkRes.json();

      if (checkData.exists && checkData.hasPasskey) {
        // Existing user with passkey — LOGIN flow
        await handleLogin(trimmed);
      } else {
        // New user or no passkey — REGISTER flow
        await handleRegister(trimmed);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      // WebAuthn user cancellation — show friendly message
      if (msg.includes("timed out") || msg.includes("not allowed") || msg.includes("AbortError") || msg.includes("NotAllowedError")) {
        setError("Passkey prompt was cancelled. Try again.");
      } else if (msg.includes("user could not be verified") || msg.includes("User verification")) {
        setError("Device verification failed. Make sure Face ID, Touch ID, or a PIN is set up on your device.");
      } else {
        setError(msg);
      }
      setLoading(false);
      setStatus(null);
    }
  };

  const handleRegister = async (emailAddr: string) => {
    setStatus("Setting up passkey...");

    // Get registration options
    const optRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "options", email: emailAddr }),
    });
    const optData = await optRes.json();
    if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

    // Start WebAuthn registration (triggers biometric/Face ID)
    const credential = await startRegistration({ optionsJSON: optData.options });

    // Verify with server
    setStatus("Verifying...");
    const verifyRes = await fetch("/api/auth/register", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: "verify",
        challengeId: optData.challengeId,
        credential,
        userId: optData.userId,
      }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(verifyData.error || "Registration failed");

    // Success — set auth state from server response
    completeAuth(verifyData.user);
  };

  const handleLogin = async (emailAddr: string) => {
    setStatus("Authenticating...");

    // Get authentication options
    const optRes = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ step: "options", email: emailAddr }),
    });
    const optData = await optRes.json();
    if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

    // Start WebAuthn authentication (triggers biometric/Face ID)
    const credential = await startAuthentication({ optionsJSON: optData.options });

    // Verify with server
    setStatus("Verifying...");
    const verifyRes = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        step: "verify",
        challengeId: optData.challengeId,
        credential,
        userId: optData.userId,
      }),
    });
    const verifyData = await verifyRes.json();
    if (!verifyRes.ok) throw new Error(verifyData.error || "Login failed");

    // Success — set auth state from server response
    completeAuth(verifyData.user);
  };

  const completeAuth = (user: {
    id: string;
    email: string;
    cardOnFile: boolean;
    cardLast4: string | null;
    gmailConnected: boolean;
    accountType?: string;
  }) => {
    // Defensive: clear stale data if a different user was previously logged in
    const currentUserId = useMeterStore.getState().userId;
    if (currentUserId && currentUserId !== user.id) {
      useMeterStore.getState().logout();
    }
    setAuth(user.id, user.email, (user.accountType as "standard" | "superadmin") ?? "standard");
    if (user.cardOnFile) {
      setCardOnFile(true, user.cardLast4 ?? undefined);
    }
    if (user.gmailConnected) {
      connectService("gmail");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") handleContinue();
  };

  return (
    <div className="relative flex h-screen flex-col items-center bg-background px-4">
      <div className="flex flex-col items-center gap-8 max-w-sm text-center mt-[28vh]">
        <div className="flex flex-col items-center gap-4">
          <Image
            src="/logo-dark-copy.webp"
            alt="Meter"
            width={108}
            height={29}
            priority
          />
          <p className="font-mono text-xs text-muted-foreground tracking-wide uppercase">
            use first, pay after
          </p>
        </div>

        <div className="flex flex-col items-center gap-3 w-full">
          <p className="text-sm text-muted-foreground leading-relaxed">
            Every model. One bill. No subscription.
          </p>
          <p className="text-xs text-muted-foreground/70 leading-relaxed">
            The meter runs in dollars. You pay what you use.
          </p>

          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="you@startup.com"
            className="w-full h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
            autoFocus
            disabled={loading}
          />

          {error && (
            <p className="font-mono text-[11px] text-red-400">{error}</p>
          )}

          {status && !error && (
            <p className="font-mono text-[11px] text-muted-foreground/60">{status}</p>
          )}

          <button
            onClick={handleContinue}
            disabled={loading || !email.trim()}
            className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2"
          >
            {loading && (
              <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            )}
            {loading ? "Authenticating..." : "Get Started"}
          </button>

          <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
            Sign in with passkey. We&apos;ll ask for a card next.
          </p>
        </div>
      </div>

      <div className="absolute bottom-8 flex flex-col items-center gap-3">
        <div className="flex items-center gap-3">
          <a href="https://x.com/meterchat" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
          </a>
          <a href="https://github.com/meterchat/meter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/40 hover:text-muted-foreground transition-colors">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
          </a>
        </div>
      </div>
    </div>
  );
}
