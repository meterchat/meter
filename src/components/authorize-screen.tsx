"use client";

import { useEffect, useState } from "react";
import { useMeterStore } from "@/lib/store";
import { authFetch } from "@/lib/auth-fetch";
import Image from "next/image";
import { WhopCheckoutEmbed } from "@whop/checkout/react";

function CardForm() {
  const { userId, email, setCardOnFile, setEmail, logout, loggingOut } = useMeterStore();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sessionId, setSessionId] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    authFetch("/api/billing/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.sessionId) {
          setSessionId(data.sessionId);
        } else {
          setError(data.error || "Failed to initialize payment");
        }
      })
      .catch(() => setError("Failed to connect to payment service"));
  }, [userId]);

  return (
    <div className="w-full max-w-sm flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <Image src="/logo-dark-copy.webp" alt="Meter" width={72} height={20} />
        <h1 className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
          Add Payment Method
        </h1>
      </div>

      {sessionId && (
        <div className="w-full rounded-xl border border-border bg-card p-5">
          <WhopCheckoutEmbed
            sessionId={sessionId}
            disableEmail
            prefill={email ? { email } : undefined}
            returnUrl={`${window.location.origin}/`}
            onComplete={() => {
              setCardOnFile(true);
            }}
          />
        </div>
      )}

      {!sessionId && !error && (
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="font-mono text-[11px] text-muted-foreground">
            Setting up payment...
          </span>
        </div>
      )}

      <div className="w-full rounded-lg border border-border/50 bg-card/50 px-4 py-3">
        <p className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
          No charge now. We verify your card and save it for billing.
          You&apos;re charged at $10 or monthly, whichever comes first.
        </p>
      </div>

      {error && (
        <p className="font-mono text-[11px] text-red-400 text-center">{error}</p>
      )}

      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {email ?? "—"}
        </span>
        <button
          onClick={logout}
          disabled={loggingOut}
          className="text-muted-foreground/40 hover:text-foreground transition-colors ml-1 disabled:opacity-50"
          title="Sign out"
        >
          {loggingOut ? (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="animate-spin">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" strokeLinecap="round" />
            </svg>
          ) : (
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
              <polyline points="16 17 21 12 16 7" />
              <line x1="21" y1="12" x2="9" y2="12" />
            </svg>
          )}
        </button>
      </div>
    </div>
  );
}

export function AuthorizeScreen() {
  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground px-4">
      <CardForm />
    </div>
  );
}
