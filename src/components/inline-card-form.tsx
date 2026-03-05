"use client";

import { useState, useEffect } from "react";
import { useMeterStore } from "@/lib/store";
import { trackCardAdded } from "@/lib/analytics";
import { apiUrl } from "@/lib/api-url";
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

function CardFormInner({ clientSecret, onComplete }: { clientSecret: string; onComplete?: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const setCardOnFile = useMeterStore((s) => s.setCardOnFile);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setLoading(true);
    setError(null);

    try {
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (result.error) throw new Error(result.error.message);

      if (result.setupIntent?.status === "succeeded") {
        const res = await fetch(apiUrl("/api/billing/confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ setupIntentId: result.setupIntent.id }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to confirm");
        trackCardAdded({ brand: data.cardBrand, last4: data.cardLast4, source: "inline_form" });
        setCardOnFile(true, data.cardLast4, data.cardBrand);
        onComplete?.();
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong");
      setLoading(false);
    }
  };

  return (
    <div className="mt-3 max-w-sm">
      <div className="rounded-lg border border-border bg-card/50 px-3 py-2.5">
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

      <p className="mt-2 font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
        A small hold verifies your card. Usage settles at $10 or when you choose.
      </p>

      {error && (
        <p className="mt-1 font-mono text-[10px] text-red-400">{error}</p>
      )}

      <button
        onClick={handleSubmit}
        disabled={loading || !stripe}
        className="mt-2 w-full rounded-lg bg-foreground py-2.5 font-mono text-xs text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
      >
        {loading ? "Saving..." : "Add Card & Start"}
      </button>
    </div>
  );
}

export function InlineCardForm({ onComplete }: { onComplete?: () => void } = {}) {
  const userId = useMeterStore((s) => s.userId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!userId) return;

    fetch(apiUrl("/api/billing/setup-intent"), {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    })
      .then((res) => {
        if (res.status === 401) {
          // Session expired — clear auth to trigger re-login
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
      <CardFormInner clientSecret={clientSecret} onComplete={onComplete} />
    </Elements>
  );
}
