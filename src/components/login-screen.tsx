"use client";

import Image from "next/image";
import { useState, useEffect } from "react";
import { useMeterStore } from "@/lib/store";
import {
  identifyUser,
  trackAccountCreated,
  trackUserLoggedIn,
  trackLoginFailed,
  trackCrossDeviceAuthStarted,
  trackWorkspaceCreated,
  trackCardAdded,
  trackOnboardingStepViewed,
} from "@/lib/analytics";
import { useWorkspaceStore } from "@/lib/workspace-store";
import {
  startRegistration,
  base64URLStringToBuffer,
  bufferToBase64URLString,
} from "@simplewebauthn/browser";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  CardElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

type OnboardingStep = "passkey" | "no-account" | "workspace" | "card";

interface PendingUser {
  id: string;
  email: string | null;
  cardOnFile: boolean;
  cardLast4: string | null;
  cardBrand?: string;
  gmailConnected: boolean;
  accountType?: string;
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

// ── Inline card form (used during onboarding) ──────────────────────────
function OnboardingCardForm({
  clientSecret,
  onComplete,
}: {
  clientSecret: string;
  onComplete: (last4?: string, brand?: string) => void;
}) {
  const stripe = useStripe();
  const elements = useElements();
  const email = useMeterStore((s) => s.email);
  const setEmail = useMeterStore((s) => s.setEmail);
  const [localEmail, setLocalEmail] = useState(email ?? "");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    // Require email for new users
    if (!email && !localEmail.trim()) {
      setError("Email is required for receipts.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      // Save email first if user doesn't have one yet
      if (!email && localEmail.trim()) {
        const emailRes = await fetch("/api/auth/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: localEmail.trim() }),
        });
        const emailData = await emailRes.json();
        if (!emailRes.ok) {
          throw new Error(emailData.error || "Failed to save email");
        }
        setEmail(emailData.email);
      }

      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (result.error) throw new Error(result.error.message);

      if (result.setupIntent?.status === "succeeded") {
        const res = await fetch("/api/billing/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupIntentId: result.setupIntent.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to confirm");
        trackCardAdded({ brand: data.cardBrand, last4: data.cardLast4, source: "onboarding" });
        onComplete(data.cardLast4, data.cardBrand);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <>
      {/* Email input — only shown for users who don't have email yet */}
      {!email && (
        <input
          type="email"
          value={localEmail}
          onChange={(e) => setLocalEmail(e.target.value)}
          placeholder="you@startup.com"
          className="w-full h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
          autoFocus
        />
      )}

      <div className="w-full rounded-lg border border-border bg-card/50 px-3 py-2.5">
        <CardElement
          options={{
            style: {
              base: {
                color: "#ffffff",
                fontFamily: "ui-monospace, monospace",
                fontSize: "13px",
                "::placeholder": { color: "#666666" },
              },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>

      {error && (
        <p className="font-mono text-[10px] text-red-400">{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !stripe}
        className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {loading ? "Saving..." : "Add Card & Start"}
      </button>

      <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
        {!email
          ? "Email is used for receipts. No charge now — usage settles daily."
          : "No charge now. Usage settles daily at midnight."}
      </p>
    </>
  );
}

// ── Card step wrapper (fetches setup intent, renders Stripe Elements) ──
function CardStep({
  onComplete,
}: {
  onComplete: (last4?: string, brand?: string) => void;
}) {
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/billing/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.clientSecret) {
          setClientSecret(data.clientSecret);
        } else {
          setError(data.error || "Failed to initialize payment");
        }
      })
      .catch(() => setError("Failed to connect to payment service"));
  }, []);

  if (error) {
    return <p className="font-mono text-[10px] text-red-400">{error}</p>;
  }

  if (!clientSecret) {
    return (
      <div className="flex items-center gap-2">
        <svg className="animate-spin h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="font-mono text-[10px] text-muted-foreground/50">Loading payment form...</span>
      </div>
    );
  }

  return (
    <Elements
      stripe={stripePromise}
      options={{
        appearance: {
          theme: "night",
          variables: {
            colorPrimary: "#ffffff",
            colorBackground: "#0a0a0a",
            colorText: "#ffffff",
            fontFamily: "ui-monospace, monospace",
          },
        },
      }}
    >
      <OnboardingCardForm clientSecret={clientSecret} onComplete={onComplete} />
    </Elements>
  );
}

// ── Progress dots ───────────────────────────────────────────────────────
function StepDots({ current, total }: { current: number; total: number }) {
  return (
    <div className="flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <div
          key={i}
          className={`h-1 rounded-full transition-all duration-300 ${
            i <= current
              ? "w-4 bg-foreground"
              : "w-1 bg-muted-foreground/30"
          }`}
        />
      ))}
    </div>
  );
}

// ── Main LoginScreen ────────────────────────────────────────────────────
export function LoginScreen() {
  const { setAuth, setCardOnFile, connectService } = useMeterStore();
  const createCompany = useWorkspaceStore((s) => s.createCompany);
  const companies = useWorkspaceStore((s) => s.companies);

  const [step, setStep] = useState<OnboardingStep>("passkey");
  const [workspaceName, setWorkspaceName] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pendingUser, setPendingUser] = useState<PendingUser | null>(null);

  // ── Passkey: Try platform authenticator first ─────────────────────
  const handleContinue = async () => {
    setLoading(true);
    setError(null);
    setStatus("Checking for passkey...");

    try {
      // 1. Get auth options from server (no email, no allowCredentials)
      const optRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "auth-options" }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

      // 2. Call navigator.credentials.get() DIRECTLY with platform-only hint
      //    This prevents the browser from showing a QR code modal
      setStatus("Authenticating...");
      const credential = await navigator.credentials.get({
        publicKey: {
          challenge: base64URLStringToBuffer(optData.options.challenge),
          rpId: optData.options.rpId,
          timeout: optData.options.timeout ?? 60000,
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
      const verifyRes = await fetch("/api/auth/passkey", {
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
      if (
        msg.includes("NotAllowedError") ||
        msg.includes("not allowed") ||
        msg.includes("AbortError") ||
        msg.includes("timed out") ||
        msg.includes("The operation either timed out")
      ) {
        setStep("no-account");
        trackOnboardingStepViewed({ step: "no-account" });
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
      const optRes = await fetch("/api/auth/passkey", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ step: "register-options" }),
      });
      const optData = await optRes.json();
      if (!optRes.ok) throw new Error(optData.error || "Failed to get options");

      const credential = await startRegistration({ optionsJSON: optData.options });

      setStatus("Verifying...");
      const verifyRes = await fetch("/api/auth/passkey", {
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
      const optRes = await fetch("/api/auth/passkey", {
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
      const verifyRes = await fetch("/api/auth/passkey", {
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

    // Set auth immediately so session cookie is active for card setup-intent
    setAuth(user.id, user.email ?? "", (user.accountType as "standard" | "superadmin") ?? "standard");

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
    // Use server-side flag — local companies store may not be populated yet
    const hasWorkspace = user.hasWorkspaces || companies.length > 0;

    // Returning user with workspace + card? Skip straight through.
    if (hasWorkspace && user.cardOnFile) {
      setCardOnFile(true, user.cardLast4 ?? undefined, user.cardBrand);
      // Auth already set — page.tsx will render ChatView once sessions load
      return;
    }

    // Hold user data for remaining steps
    setPendingUser(user);
    setLoading(false);
    setStatus(null);
    setError(null);

    if (!hasWorkspace) {
      setStep("workspace");
      trackOnboardingStepViewed({ step: "workspace" });
    } else if (!user.cardOnFile) {
      setStep("card");
      trackOnboardingStepViewed({ step: "card" });
    }
  };

  // ── Step 2: Name Workspace ──────────────────────────────────────────
  const handleWorkspaceContinue = () => {
    const trimmed = workspaceName.trim();
    if (!trimmed) return;

    createCompany(trimmed);
    trackWorkspaceCreated({ name: trimmed, source: "onboarding" });

    if (pendingUser?.cardOnFile) {
      // Has card already (edge case) — finalize
      setCardOnFile(true, pendingUser.cardLast4 ?? undefined, pendingUser.cardBrand);
      return;
    }

    setError(null);
    setStep("card");
    trackOnboardingStepViewed({ step: "card" });
  };

  // ── Step 3: Add Card ────────────────────────────────────────────────
  const handleCardComplete = (last4?: string, brand?: string) => {
    setCardOnFile(true, last4, brand);
    // Auth was already set in afterPasskey — page.tsx now shows ChatView
  };

  // ── Key handlers ────────────────────────────────────────────────────
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== "Enter") return;
    if (step === "workspace") handleWorkspaceContinue();
  };

  // ── Step index for dots ─────────────────────────────────────────────
  const stepIndex = step === "workspace" ? 0 : 1;
  const showDots = step === "workspace" || step === "card";

  return (
    <div className="relative flex h-screen flex-col items-center bg-background px-4">
      <div className="flex flex-col items-center gap-8 max-w-sm text-center mt-[28vh]">
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
          {(step === "passkey" || step === "no-account") && (
            <p className="font-mono text-xs text-muted-foreground tracking-wide uppercase">
              pay per thought
            </p>
          )}
          {showDots && <StepDots current={stepIndex} total={2} />}
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

        {/* ── Workspace step ─────────────────────────────────────── */}
        {step === "workspace" && (
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Name your workspace
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              A workspace isolates conversations, costs, and connected services.
            </p>

            <input
              type="text"
              value={workspaceName}
              onChange={(e) => setWorkspaceName(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="e.g. Acme, Personal, Side Project"
              className="w-full h-10 rounded-lg border border-border bg-card px-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:border-foreground/30 transition-colors"
              autoFocus
            />

            {error && (
              <p className="font-mono text-[11px] text-red-400">{error}</p>
            )}

            <button
              onClick={handleWorkspaceContinue}
              disabled={!workspaceName.trim()}
              className="w-full h-10 rounded-lg bg-foreground text-background text-sm font-medium transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2"
            >
              Continue
            </button>

            <p className="font-mono text-[10px] text-muted-foreground/40 leading-relaxed">
              You can create more workspaces later.
            </p>
          </div>
        )}

        {/* ── Card step ──────────────────────────────────────────── */}
        {step === "card" && (
          <div className="flex flex-col items-center gap-3 w-full">
            <p className="text-sm text-muted-foreground leading-relaxed">
              Add a payment card
            </p>
            <p className="text-xs text-muted-foreground/70 leading-relaxed">
              You won&apos;t be charged until usage settles.
            </p>

            <CardStep onComplete={handleCardComplete} />
          </div>
        )}
      </div>

      {/* Footer — always visible */}
      <div className="absolute bottom-8 flex flex-col items-center gap-3">
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
