"use client";

import { useEffect, useState } from "react";
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

function AddCardForm({ clientSecret, onSuccess }: { clientSecret: string; onSuccess: () => void }) {
  const stripe = useStripe();
  const elements = useElements();
  const userId = useMeterStore((s) => s.userId);
  const fetchCards = useMeterStore((s) => s.fetchCards);
  const setCardOnFile = useMeterStore((s) => s.setCardOnFile);

  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async () => {
    if (!stripe || !elements || !userId) return;
    const cardElement = elements.getElement(CardElement);
    if (!cardElement) return;

    setLoading(true);
    setError(null);
    setStatus("Saving card...");

    try {
      const result = await stripe.confirmCardSetup(clientSecret, {
        payment_method: { card: cardElement },
      });

      if (result.error) throw new Error(result.error.message);

      if (result.setupIntent?.status === "succeeded") {
        setStatus("Confirming...");
        const res = await fetch(apiUrl("/api/billing/confirm"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            setupIntentId: result.setupIntent.id,
          }),
        });
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "Failed to confirm");
        trackCardAdded({ brand: data.cardBrand, last4: data.cardLast4, source: "modal" });
        setCardOnFile(true, data.cardLast4, data.cardBrand);
        await fetchCards();
        onSuccess();
        return;
      }

      throw new Error("Setup failed");
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Something went wrong";
      setError(msg);
      setStatus(null);
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="rounded-xl border border-border bg-card/50 p-4">
        <CardElement
          options={{
            style: {
              base: {
                color: "#ffffff",
                fontFamily: "ui-monospace, monospace",
                fontSize: "14px",
                "::placeholder": { color: "#666666" },
              },
              invalid: { color: "#ef4444" },
            },
          }}
        />
      </div>

      <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
        <p className="font-mono text-[11px] text-muted-foreground/60 leading-relaxed">
          A small hold verifies your card. Usage settles automatically
          when your balance reaches $10, or you can settle anytime.
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
        className="w-full rounded-lg bg-foreground py-2.5 font-mono text-[12px] text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 flex items-center justify-center gap-2"
      >
        {loading && (
          <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
        )}
        {loading ? "Saving..." : "Add Card"}
      </button>
    </div>
  );
}

export function AddCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useMeterStore((s) => s.userId);
  const [clientSecret, setClientSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setClientSecret(null);
    setError(null);

    if (!userId) {
      setError("Missing user session");
      return;
    }

    fetch(apiUrl("/api/billing/setup-intent"), {
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
  }, [open, userId]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      <div className="absolute inset-0 bg-background/60 backdrop-blur-sm" onClick={onClose} />
      <div className="absolute left-1/2 top-1/2 w-[420px] max-w-[92vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-border bg-card shadow-xl">
        <div className="flex items-center justify-between border-b border-border px-4 py-3">
          <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
            Add Payment Method
          </span>
          <button
            onClick={onClose}
            className="text-muted-foreground hover:text-foreground transition-colors"
            aria-label="Close add card dialog"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-4 py-4">
          {error && (
            <p className="font-mono text-[11px] text-red-400 text-center">{error}</p>
          )}

          {!error && !clientSecret && (
            <div className="flex items-center justify-center gap-2 py-8">
              <svg className="animate-spin h-4 w-4 text-muted-foreground" viewBox="0 0 24 24" fill="none">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
              <span className="font-mono text-[11px] text-muted-foreground">
                Setting up payment...
              </span>
            </div>
          )}

          {!error && clientSecret && (
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
              <AddCardForm clientSecret={clientSecret} onSuccess={onClose} />
            </Elements>
          )}
        </div>
      </div>
    </div>
  );
}
