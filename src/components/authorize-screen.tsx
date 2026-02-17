"use client";

import { useState } from "react";
import { useMeterStore } from "@/lib/store";
import Image from "next/image";

export function AuthorizeScreen() {
  const { email, setCardOnFile, logout } = useMeterStore();
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState<string | null>(null);
  const [cardNumber, setCardNumber] = useState("");
  const [expiry, setExpiry] = useState("");
  const [cvc, setCvc] = useState("");

  const handleAuthorize = async () => {
    setLoading(true);
    setStatus(null);

    try {
      setStatus("Verifying card...");
      // Production: POST /api/billing/setup-intent → Stripe SetupIntent → confirm → save PaymentMethod
      await new Promise((r) => setTimeout(r, 1200));
      setCardOnFile(true);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      setStatus(`Error: ${msg}`);
      setLoading(false);
    }
  };

  const formatCard = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 16);
    return digits.replace(/(.{4})/g, "$1 ").trim();
  };

  const formatExpiry = (v: string) => {
    const digits = v.replace(/\D/g, "").slice(0, 4);
    if (digits.length > 2) return `${digits.slice(0, 2)}/${digits.slice(2)}`;
    return digits;
  };

  const isValid =
    cardNumber.replace(/\s/g, "").length >= 15 &&
    expiry.length >= 4 &&
    cvc.length >= 3;

  return (
    <div className="flex h-screen flex-col items-center justify-center bg-background text-foreground px-4">
      <div className="w-full max-w-sm flex flex-col items-center gap-6">
        <div className="flex flex-col items-center gap-2">
          <Image src="/logo-dark-copy.webp" alt="Meter" width={72} height={20} />
          <h1 className="font-mono text-[11px] text-muted-foreground uppercase tracking-[0.2em]">
            Add Payment Method
          </h1>
        </div>

        <div className="w-full rounded-xl border border-border bg-card p-5 flex flex-col gap-0">
          <div className="py-3">
            <label className="font-mono text-[10px] text-muted-foreground tracking-wider block mb-1.5">
              Card Number
            </label>
            <input
              type="text"
              value={cardNumber}
              onChange={(e) => setCardNumber(formatCard(e.target.value))}
              placeholder="4242 4242 4242 4242"
              className="w-full bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
              autoFocus
            />
          </div>

          <div className="h-px bg-border" />

          <div className="flex gap-4 py-3">
            <div className="flex-1">
              <label className="font-mono text-[10px] text-muted-foreground tracking-wider block mb-1.5">
                Expiry
              </label>
              <input
                type="text"
                value={expiry}
                onChange={(e) => setExpiry(formatExpiry(e.target.value))}
                placeholder="MM/YY"
                className="w-full bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
              />
            </div>
            <div className="w-20">
              <label className="font-mono text-[10px] text-muted-foreground tracking-wider block mb-1.5">
                CVC
              </label>
              <input
                type="text"
                value={cvc}
                onChange={(e) => setCvc(e.target.value.replace(/\D/g, "").slice(0, 4))}
                placeholder="123"
                className="w-full bg-transparent font-mono text-sm text-foreground placeholder:text-muted-foreground/30 focus:outline-none"
              />
            </div>
          </div>

          <div className="h-px bg-border" />

          <div className="flex items-center justify-between py-3">
            <span className="font-mono text-[10px] text-muted-foreground tracking-wider">
              Auth Hold
            </span>
            <span className="font-mono text-sm text-muted-foreground">
              $0.00
            </span>
          </div>
        </div>

        <div className="w-full rounded-lg border border-border/50 bg-card/50 px-4 py-3">
          <p className="font-mono text-[10px] text-muted-foreground/60 leading-relaxed">
            No charge now. We verify your card and save it for billing.
            You&apos;re charged at $10 or monthly, whichever comes first.
          </p>
        </div>

        {status && (
          <p className="font-mono text-[11px] text-muted-foreground/60 text-center">
            {status}
          </p>
        )}

        <button
          onClick={handleAuthorize}
          disabled={loading || !isValid}
          className="w-full rounded-xl bg-foreground py-3.5 font-mono text-sm text-background transition-colors hover:bg-foreground/90 disabled:opacity-50 flex items-center justify-center gap-2"
        >
          {loading && (
            <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24" fill="none">
              <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
              <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
            </svg>
          )}
          {loading ? "Verifying..." : "Add Card & Start Chatting"}
        </button>

        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-emerald-500" />
          <span className="font-mono text-[10px] text-muted-foreground/40">
            {email}
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
    </div>
  );
}
