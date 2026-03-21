"use client";

import { useState, useEffect } from "react";
import { useMeterStore } from "@/lib/store";
import { trackCardAdded } from "@/lib/analytics";
import { authFetch } from "@/lib/auth-fetch";
import { StripeProvider } from "@/components/stripe-provider";
import { PaymentElement, useStripe, useElements } from "@stripe/react-stripe-js";

function CardFormInner({ onComplete }: { onComplete?: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const setCardOnFile = useMeterStore((s) => s.setCardOnFile);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!stripe || !elements) return;

    setSubmitting(true);
    setError(null);

    const { error: stripeError } = await stripe.confirmSetup({
      elements,
      redirect: "if_required",
    });

    if (stripeError) {
      setError(stripeError.message ?? "Payment setup failed");
      setSubmitting(false);
    } else {
      trackCardAdded({ brand: "card", last4: "****", source: "inline_form" });
      setCardOnFile(true);
      onComplete?.();
    }
  }

  return (
    <form onSubmit={handleSubmit} className="flex flex-col gap-3">
      <PaymentElement />
      {error && (
        <p className="font-mono text-[10px] text-red-400">{error}</p>
      )}
      <button
        type="submit"
        disabled={!stripe || submitting}
        className="w-full rounded-lg bg-emerald-600 px-3 py-1.5 font-mono text-[10px] text-white hover:bg-emerald-500 transition-colors disabled:opacity-50"
      >
        {submitting ? "Saving..." : "Save Card"}
      </button>
    </form>
  );
}

export function InlineCardForm({ onComplete }: { onComplete?: () => void } = {}) {
  const userId = useMeterStore((s) => s.userId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    authFetch("/api/billing/setup-intent", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => {
        if (res.status === 401) {
          useMeterStore.setState({ authenticated: false, sessionsLoaded: false });
          return null;
        }
        return res.json();
      })
      .then((data) => {
        if (!data) return;
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
      <p className="mt-3 font-mono text-[10px] text-red-400">{error}</p>
    );
  }

  if (!clientSecret) {
    return (
      <div className="mt-3 flex items-center gap-2">
        <svg className="animate-spin h-3 w-3 text-muted-foreground" viewBox="0 0 24 24" fill="none">
          <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
          <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
        </svg>
        <span className="font-mono text-[10px] text-muted-foreground/50">Loading payment form...</span>
      </div>
    );
  }

  return (
    <div className="mt-3 max-w-sm">
      <StripeProvider clientSecret={clientSecret}>
        <CardFormInner onComplete={onComplete} />
      </StripeProvider>

      <p className="mt-2 font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
        A small hold verifies your card. Usage settles at $10 or when you choose.
      </p>
    </div>
  );
}
