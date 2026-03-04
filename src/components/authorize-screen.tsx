"use client";

import { useState, useEffect } from "react";
import { useMeterStore } from "@/lib/store";
import Image from "next/image";
import { loadStripe } from "@stripe/stripe-js";
import {
  Elements,
  PaymentElement,
  useStripe,
  useElements,
} from "@stripe/react-stripe-js";

const stripePromise = loadStripe(
  process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY!
);

function CardForm() {
  const stripe = useStripe();
  const elements = useElements();
  const { userId, email, setCardOnFile, setEmail, logout } = useMeterStore();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [localEmail, setLocalEmail] = useState(email ?? "");

  const handleSubmit = async () => {
    if (!stripe || !elements) return;

    // If no email on file, collect it first
    if (!email) {
      const trimmed = localEmail.trim().toLowerCase();
      if (!trimmed || !trimmed.includes("@")) {
        setError("Valid email required for receipts");
        return;
      }

      setLoading(true);
      setError(null);
      setStatus("Saving email...");

      try {
        const emailRes = await fetch("/api/auth/email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email: trimmed }),
        });
        const emailData = await emailRes.json();
        if (!emailRes.ok) throw new Error(emailData.error || "Failed to save email");
        setEmail(trimmed);
      } catch (err) {
        const msg = err instanceof Error ? err.message : "Failed to save email";
        setError(msg);
        setStatus(null);
        setLoading(false);
        return;
      }
    }

    setLoading(true);
    setError(null);
    setStatus("Saving card...");

    try {
      const { error: submitError } = await elements.submit();
      if (submitError) throw new Error(submitError.message);

      const { error: confirmError, setupIntent } = await stripe.confirmSetup({
        elements,
        redirect: "if_required",
      });

      if (confirmError) throw new Error(confirmError.message);

      if (setupIntent?.status === "succeeded") {
        // Confirm with our server to save card details
        setStatus("Confirming...");
        const res = await fetch("/api/billing/confirm", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setupIntentId: setupIntent.id,
          }),
        });
        const data = await res.json();

        if (!res.ok) throw new Error(data.error || "Failed to confirm");

        setCardOnFile(true, data.cardLast4, data.cardBrand);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setStatus(null);
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-sm flex flex-col items-center gap-6">
      <div className="flex flex-col items-center gap-2">
        <Image src="/logo-dark-copy.webp" alt="Meter" width={72} height={20} />
        <h1 className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
          Add Payment Method
        </h1>
      </div>

      {!email && (
        <div className="w-full">
          <label className="block font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider mb-1.5 px-1">
            Email (for receipts)
          </label>
          <input
            type="email"
            value={localEmail}
            onChange={(e) => setLocalEmail(e.target.value)}
            placeholder="you@example.com"
            className="w-full rounded-xl border border-border bg-card px-4 py-3 font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none focus:border-foreground/30 transition-colors"
          />
        </div>
      )}

      <div className="w-full rounded-xl border border-border bg-card p-5">
        <PaymentElement
          options={{
            layout: "tabs",
          }}
        />
      </div>

      <div className="w-full rounded-lg border border-border/50 bg-card/50 px-4 py-3">
        <p className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
          No charge now. We verify your card and save it for billing.
          You&apos;re charged at $10 or monthly, whichever comes first.
        </p>
      </div>

      {error && (
        <p className="font-mono text-[11px] text-red-400 text-center">{error}</p>
      )}

      {status && !error && (
        <p className="font-mono text-[11px] text-muted-foreground/60 text-center">{status}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !stripe}
        className="w-full rounded-xl bg-foreground py-3.5 font-mono text-sm text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {loading ? "Saving..." : "Add Card & Continue"}
      </button>

      <div className="flex items-center gap-2">
        <span className="h-2 w-2 rounded-full bg-emerald-500" />
        <span className="font-mono text-[10px] text-muted-foreground/40">
          {email ?? "—"}
        </span>
        <button
          onClick={logout}
          className="text-muted-foreground/40 hover:text-foreground transition-colors ml-1"
          title="Sign out"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
            <polyline points="16 17 21 12 16 7" />
            <line x1="21" y1="12" x2="9" y2="12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

export function AuthorizeScreen() {
  const { userId } = useMeterStore();
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

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
  }, [userId]);

  if (error) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground px-4">
        <p className="font-mono text-[11px] text-red-400">{error}</p>
      </div>
    );
  }

  if (!clientSecret) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground px-4">
        <div className="flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <span className="font-mono text-[11px] text-muted-foreground">
            Setting up payment...
          </span>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground px-4">
      <Elements
        stripe={stripePromise}
        options={{
          clientSecret,
          appearance: {
            theme: "night",
            variables: {
              colorPrimary: "#ffffff",
              colorBackground: "#212121",
              colorText: "#ffffff",
              colorTextPlaceholder: "#666666",
              fontFamily: "ui-monospace, monospace",
              fontSizeBase: "14px",
              borderRadius: "8px",
            },
          },
        }}
      >
        <CardForm />
      </Elements>
    </div>
  );
}
