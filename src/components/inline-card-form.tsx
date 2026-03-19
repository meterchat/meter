"use client";

import { useState, useEffect } from "react";
import { useMeterStore } from "@/lib/store";
import { trackCardAdded } from "@/lib/analytics";
import { authFetch } from "@/lib/auth-fetch";
import { WhopCheckoutEmbed } from "@whop/checkout/react";
import { Spinner } from "@/components/ui/spinner";

export function InlineCardForm({ onComplete }: { onComplete?: () => void } = {}) {
  const userId = useMeterStore((s) => s.userId);
  const setCardOnFile = useMeterStore((s) => s.setCardOnFile);
  const [sessionId, setSessionId] = useState<string | null>(null);
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
        if (data.sessionId) {
          setSessionId(data.sessionId);
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

  if (!sessionId) {
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
      <WhopCheckoutEmbed
        sessionId={sessionId}
        hideEmail
        theme="dark"
        returnUrl={`${window.location.origin}/`}
        onComplete={() => {
          trackCardAdded({ brand: "card", last4: "****", source: "inline_form" });
          setCardOnFile(true);
          onComplete?.();
        }}
        fallback={
          <div className="flex items-center gap-2 py-4">
            <Spinner className="size-3 text-muted-foreground" />
            <span className="font-mono text-[10px] text-muted-foreground/50">
              Loading payment form...
            </span>
          </div>
        }
      />

      <p className="mt-2 font-mono text-[10px] text-muted-foreground/50 leading-relaxed">
        A small hold verifies your card. Usage settles at $10 or when you choose.
      </p>
    </div>
  );
}
