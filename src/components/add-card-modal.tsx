"use client";

import { useEffect, useState } from "react";
import { useMeterStore } from "@/lib/store";
import { trackCardAdded } from "@/lib/analytics";
import { authFetch } from "@/lib/auth-fetch";
import { WhopCheckoutEmbed } from "@whop/checkout/react";
import { Spinner } from "@/components/ui/spinner";

export function AddCardModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const userId = useMeterStore((s) => s.userId);
  const email = useMeterStore((s) => s.email);
  const fetchCards = useMeterStore((s) => s.fetchCards);
  const setCardOnFile = useMeterStore((s) => s.setCardOnFile);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setSessionId(null);
    setError(null);

    if (!userId) {
      setError("Missing user session");
      return;
    }

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

          {!error && !sessionId && (
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

          {!error && sessionId && (
            <div className="flex flex-col gap-4">
              <WhopCheckoutEmbed
                sessionId={sessionId}
                disableEmail
                theme="dark"
                prefill={email ? { email } : undefined}
                returnUrl={`${window.location.origin}/`}
                onComplete={() => {
                  trackCardAdded({ brand: "card", last4: "****", source: "modal" });
                  setCardOnFile(true);
                  fetchCards();
                  onClose();
                }}
                fallback={
                  <div className="flex flex-col items-center justify-center gap-3 py-12">
                    <Spinner className="size-5 text-muted-foreground" />
                    <span className="font-mono text-[11px] text-muted-foreground">
                      Loading payment form...
                    </span>
                  </div>
                }
              />

              <div className="rounded-lg border border-border/50 bg-card/50 px-4 py-3">
                <p className="font-mono text-[11px] text-muted-foreground/60 leading-relaxed">
                  A small hold verifies your card. Usage settles automatically
                  when your balance reaches $10, or you can settle anytime.
                </p>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
