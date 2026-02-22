"use client";

import Image from "next/image";
import { useEffect, useState, type FormEvent } from "react";
import { useMeterStore } from "@/lib/store";
import { startRegistration, startAuthentication } from "@simplewebauthn/browser";

export function LoginScreen() {
  const { setAuth, setCardOnFile, connectService } = useMeterStore();
  const [email, setEmail] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const html = document.documentElement;
    const prev = html.style.scrollBehavior;
    html.style.scrollBehavior = "smooth";
    return () => {
      html.style.scrollBehavior = prev;
    };
  }, []);

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

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    handleContinue();
  };

  const navItems = [
    { label: "Home", href: "#home" },
    { label: "Accounts", href: "#accounts" },
    { label: "Cards", href: "#cards" },
    { label: "Wallets", href: "#wallets" },
    { label: "About", href: "#about" },
    { label: "Docs", href: "/docs" },
  ];

  const integrations = ["Stripe", "Mercury", "Brex", "Ramp", "Gmail", "Notion", "Linear"];

  const featureCards = [
    {
      title: "Pay per thought",
      description: "Postpaid usage with a real-time meter. No seats, no subscriptions.",
    },
    {
      title: "Agent wallet",
      description: "Provision a wallet and card so Meter can pay on your behalf.",
    },
    {
      title: "Unified visibility",
      description: "Usage, subscriptions, and transactions in a single ledger.",
    },
    {
      title: "Auto-routing",
      description: "Routes to the best available model to stay fast and reliable.",
    },
    {
      title: "Approvals & limits",
      description: "Guardrails for high-stakes spend with instant approvals.",
    },
    {
      title: "Decisions logged",
      description: "Every commitment captured with owners and follow-ups.",
    },
    {
      title: "Connect your stack",
      description: "Stripe, Mercury, Brex, Ramp, Gmail, and more in minutes.",
    },
    {
      title: "Multiple workspaces",
      description: "Separate startups, projects, and products cleanly.",
    },
  ];

  return (
    <div className="relative min-h-screen bg-background text-foreground scroll-smooth overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.08),transparent_55%)]" />
      <div className="pointer-events-none absolute left-1/2 top-[-10%] h-[460px] w-[460px] -translate-x-1/2 rounded-full bg-[radial-gradient(circle,rgba(59,130,246,0.2),transparent_60%)] blur-3xl" />
      <div className="pointer-events-none absolute right-[-10%] top-[20%] h-[300px] w-[300px] rounded-full bg-[radial-gradient(circle,rgba(16,185,129,0.16),transparent_60%)] blur-3xl" />

      <header className="sticky top-0 z-20 border-b border-border/70 bg-background/80 backdrop-blur">
        <div className="mx-auto flex h-14 w-full max-w-6xl items-center gap-6 px-4">
          <a href="#home" className="flex items-center gap-3">
            <Image src="/logo-dark-copy.webp" alt="Meter" width={80} height={22} priority />
            <span className="hidden sm:inline font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
              intelligence that pays
            </span>
          </a>

          <nav className="hidden lg:flex items-center gap-6 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70">
            {navItems.map((item) => (
              <a
                key={item.label}
                href={item.href}
                className="transition-colors hover:text-foreground"
              >
                {item.label}
              </a>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-3">
            <form
              onSubmit={handleSubmit}
              className="hidden md:flex items-center gap-2 rounded-full border border-border bg-card/80 px-2 py-1 shadow-sm"
            >
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@startup.com"
                className="h-7 w-40 bg-transparent px-2 font-mono text-[11px] text-foreground placeholder:text-muted-foreground/60 focus:outline-none"
                disabled={loading}
              />
              <button
                type="submit"
                disabled={loading || !email.trim()}
                className="flex h-7 items-center justify-center rounded-full bg-foreground px-3 text-[10px] font-mono uppercase tracking-wide text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
              >
                Start
              </button>
            </form>
            <a
              href="#get-started"
              className="md:hidden font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70"
            >
              Get Started
            </a>
          </div>
        </div>
      </header>

      <main className="relative">
        <section
          id="get-started"
          className="mx-auto grid w-full max-w-6xl gap-12 px-4 pt-16 pb-20 lg:grid-cols-[1.1fr_0.9fr] lg:items-center animate-in fade-in-0 duration-700"
        >
          <div id="home" className="space-y-6">
            <div className="space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-[0.4em] text-muted-foreground/70">
                Meter OS
              </p>
              <h1 className="text-4xl font-semibold tracking-tight text-foreground sm:text-6xl">
                Intelligence that pays
              </h1>
              <p className="max-w-2xl text-base text-muted-foreground/80">
                Meter is the financial operating system for founders. It is the
                first AI agent with its own card and wallet, built to pay for
                services, manage spend, and keep every decision in context.
              </p>
              <p className="max-w-2xl text-sm text-muted-foreground/70">
                Postpaid usage billing means you pay per thought, not per month.
                Connect Stripe, Mercury, Brex, Ramp, Gmail, and more; Meter
                auto-routes across top models to stay fast and avoid rate limits.
              </p>
            </div>

            <form onSubmit={handleSubmit} className="space-y-3">
              <div className="flex flex-col gap-3 sm:flex-row">
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@startup.com"
                  className="h-11 flex-1 rounded-lg border border-border bg-card px-4 font-mono text-sm text-foreground placeholder:text-muted-foreground/60 focus:outline-none focus:border-foreground/40 transition-colors"
                  autoFocus
                  disabled={loading}
                />
                <button
                  type="submit"
                  disabled={loading || !email.trim()}
                  className="h-11 rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 active:bg-foreground/80 disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {loading && (
                    <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  {loading ? "Authenticating..." : "Get Started"}
                </button>
              </div>

              {error && (
                <p className="font-mono text-[11px] text-red-500">{error}</p>
              )}

              {status && !error && (
                <p className="font-mono text-[11px] text-muted-foreground/70">{status}</p>
              )}

              <p className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
                Sign in with passkey. We&apos;ll ask for a card next.
              </p>
            </form>

            <div className="flex flex-wrap items-center gap-2 pt-2">
              {integrations.map((item) => (
                <span
                  key={item}
                  className="rounded-full border border-border/70 bg-card/80 px-3 py-1 text-[10px] font-mono uppercase tracking-widest text-muted-foreground/70"
                >
                  {item}
                </span>
              ))}
            </div>
          </div>

          <div className="space-y-6">
            <div className="rounded-3xl border border-border bg-gradient-to-br from-card to-background/80 p-6 shadow-[0_20px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/5">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  METER_
                </span>
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  •••• 4891
                </span>
              </div>
              <div className="mt-6 space-y-2">
                <p className="text-xs text-muted-foreground/70">Balance</p>
                <p className="text-3xl font-semibold tracking-tight">$12,450.00</p>
              </div>
              <div className="mt-6 grid grid-cols-2 gap-4 text-xs text-muted-foreground/70">
                <div>
                  <p className="uppercase font-mono text-[10px]">Exp</p>
                  <p className="text-foreground/80">08/26</p>
                </div>
                <div>
                  <p className="uppercase font-mono text-[10px]">Cardholder</p>
                  <p className="text-foreground/80">Ops Agent-01</p>
                </div>
              </div>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Live Meter
                </p>
                <span className="rounded-full bg-emerald-500/10 px-2 py-0.5 text-[10px] font-mono uppercase text-emerald-400">
                  Active
                </span>
              </div>
              <div className="mt-4 grid gap-3 text-sm text-muted-foreground/70">
                <div className="flex items-center justify-between">
                  <span>Today</span>
                  <span className="font-mono text-foreground">$42.18</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>This month</span>
                  <span className="font-mono text-foreground">$1,284.60</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Pending approvals</span>
                  <span className="font-mono text-foreground">3</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl px-4 pb-20 animate-in fade-in-0 duration-700">
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            {featureCards.map((feature) => (
              <div
                key={feature.title}
                className="group rounded-2xl border border-border bg-card p-4 transition-all duration-200 hover:-translate-y-1 hover:border-foreground/30 hover:bg-card/80"
              >
                <h3 className="text-sm font-semibold text-foreground">{feature.title}</h3>
                <p className="mt-2 text-xs text-muted-foreground/70">{feature.description}</p>
              </div>
            ))}
          </div>
        </section>

        <section
          id="accounts"
          className="mx-auto w-full max-w-6xl border-t border-border/70 px-4 py-16"
        >
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
                01. Accounts
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">Agent wallets with real spending power</h2>
              <p className="text-sm text-muted-foreground/70">
                Provision an agent wallet in seconds. Meter pays for tools,
                services, and purchases while you keep every transaction tied to
                a decision trail.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground/70">
                <li>Instant provisioning per workspace.</li>
                <li>Spending limits and approval thresholds baked in.</li>
                <li>Every purchase linked to context and follow-ups.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                Terminal
              </div>
              <pre className="mt-4 rounded-xl border border-border/70 bg-background/60 p-4 text-[11px] leading-5 text-foreground/80">
{`$ meter wallet create --label "Ops Agent" --workspace ws_8a3f1b
{
  "id": "wal_4e7b2c91",
  "label": "Ops Agent",
  "status": "active",
  "balance": "0.00",
  "created_at": "2026-02-20T09:22:11Z"
}`}
              </pre>
            </div>
          </div>
        </section>

        <section
          id="cards"
          className="mx-auto w-full max-w-6xl border-t border-border/70 px-4 py-16"
        >
          <div className="grid gap-10 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
            <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
              <div className="flex items-center justify-between">
                <span className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Controls
                </span>
                <span className="rounded-full border border-border px-2 py-0.5 text-[10px] font-mono uppercase text-muted-foreground/70">
                  Policy
                </span>
              </div>
              <div className="mt-5 space-y-3 text-sm text-muted-foreground/70">
                <div className="flex items-center justify-between">
                  <span>Per transaction limit</span>
                  <span className="font-mono text-foreground">$250</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Daily limit</span>
                  <span className="font-mono text-foreground">$2,000</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Approval required</span>
                  <span className="font-mono text-foreground">Over $500</span>
                </div>
              </div>
              <div className="mt-5 rounded-xl border border-border/70 bg-background/60 p-4 text-xs text-muted-foreground/70">
                Meter requests approval before high-stakes purchases and logs the
                rationale alongside every spend.
              </div>
            </div>

            <div className="space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
                02. Cards
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">Approvals and controls built in</h2>
              <p className="text-sm text-muted-foreground/70">
                Set guardrails for high-stakes purchases so the agent can move fast
                without surprises. Every charge hits your policy first.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground/70">
                <li>Custom approval thresholds per workspace.</li>
                <li>Real-time prompts before charges clear.</li>
                <li>Audit trails tied to every purchase.</li>
              </ul>
            </div>
          </div>
        </section>

        <section
          id="wallets"
          className="mx-auto w-full max-w-6xl border-t border-border/70 px-4 py-16"
        >
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
            <div className="space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
                03. Wallets
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">Full visibility into startup spend</h2>
              <p className="text-sm text-muted-foreground/70">
                See usage, subscriptions, and transactions in one place across the
                tools your startup already runs on.
              </p>
              <ul className="space-y-2 text-sm text-muted-foreground/70">
                <li>Unified ledger of AI usage and vendor spend.</li>
                <li>Decision logs attached to each transaction.</li>
                <li>Monthly and daily limits tracked in real time.</li>
              </ul>
            </div>
            <div className="rounded-2xl border border-border bg-card p-5 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
              <div className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                Recent Activity
              </div>
              <div className="mt-4 space-y-3 text-sm text-muted-foreground/70">
                <div className="flex items-center justify-between">
                  <span>Model routing · Anthropic</span>
                  <span className="font-mono text-foreground">$18.40</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Gmail follow-up</span>
                  <span className="font-mono text-foreground">$4.80</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Ramp subscription sync</span>
                  <span className="font-mono text-foreground">$1.20</span>
                </div>
                <div className="flex items-center justify-between">
                  <span>Decision log export</span>
                  <span className="font-mono text-foreground">$0.60</span>
                </div>
              </div>
            </div>
          </div>
        </section>

        <section
          id="about"
          className="mx-auto w-full max-w-6xl border-t border-border/70 px-4 py-16"
        >
          <div className="grid gap-10 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
            <div className="space-y-4">
              <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
                04. About
              </p>
              <h2 className="text-2xl font-semibold tracking-tight">Decisions and follow-ups, automatically logged</h2>
              <p className="text-sm text-muted-foreground/70">
                Meter keeps your startup&apos;s context and commitments from getting
                lost. Decisions, approvals, and follow-ups are captured
                automatically so you can move fast with confidence.
              </p>
            </div>
            <div className="rounded-2xl border border-border bg-card p-6 shadow-[0_12px_36px_rgba(0,0,0,0.35)]">
              <div className="space-y-3 text-sm text-muted-foreground/70">
                <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/70">
                  Why Meter
                </p>
                <p>
                  Postpaid usage, unified spend visibility, and a programmable
                  agent wallet in one operating system.
                </p>
                <p>
                  Create multiple workspaces for separate startups, projects, and
                  products with their own connections, controls, and history.
                </p>
              </div>
            </div>
          </div>
        </section>

        <section className="mx-auto w-full max-w-6xl border-t border-border/70 px-4 py-16">
          <div className="rounded-3xl border border-border bg-card p-8 text-center shadow-[0_20px_60px_rgba(0,0,0,0.45)] ring-1 ring-white/5">
            <p className="font-mono text-[11px] uppercase tracking-widest text-muted-foreground/70">
              Ready to ship faster?
            </p>
            <h3 className="mt-3 text-2xl font-semibold tracking-tight">
              Connect your stack, set guardrails, and let Meter run the financial layer.
            </h3>
            <p className="mt-3 text-sm text-muted-foreground/70">
              Start with your email. Create a passkey in seconds.
            </p>
            <div className="mt-6 flex justify-center">
              <button
                onClick={handleContinue}
                disabled={loading || !email.trim()}
                className="h-11 rounded-lg bg-foreground px-6 text-sm font-medium text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
              >
                {loading ? "Authenticating..." : "Get Started"}
              </button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-border/70">
        <div className="mx-auto flex w-full max-w-6xl flex-col items-center justify-between gap-4 px-4 py-8 sm:flex-row">
          <p className="font-mono text-[10px] uppercase tracking-widest text-muted-foreground/60">
            Meter © 2026
          </p>
          <div className="flex items-center gap-3">
            <a href="https://x.com/meterchat" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/60 hover:text-foreground transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>
            </a>
            <a href="https://github.com/meterchat/meter" target="_blank" rel="noopener noreferrer" className="text-muted-foreground/60 hover:text-foreground transition-colors">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            </a>
          </div>
        </div>
      </footer>
    </div>
  );
}
