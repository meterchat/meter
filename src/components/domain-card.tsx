"use client";

import { useState } from "react";
import { ActionCard as ActionCardType, useMeterStore } from "@/lib/store";

interface DomainCardProps {
  card: ActionCardType;
  messageId: string;
}

export function DomainCard({ card, messageId }: DomainCardProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const purchaseDomain = useMeterStore((s) => s.purchaseDomain);
  const rejectCard = useMeterStore((s) => s.rejectCard);
  const addMessage = useMeterStore((s) => s.addMessage);

  const isAvailable = card.metadata?.available === "true";
  const isPremium = card.metadata?.premium === "true";
  const renewalPrice = card.metadata?.renewalPrice;
  const tld = card.metadata?.tld ?? card.title.split(".").pop();
  const isPending = card.status === "pending";
  const isPurchased = card.status === "approved";
  const isSkipped = card.status === "rejected";

  async function handleBuy() {
    setLoading(true);
    setError(null);
    const result = await purchaseDomain(messageId, card.id);
    setLoading(false);
    if (!result.success) {
      setError(result.error ?? "Registration failed");
    } else if (result.domain) {
      addMessage({
        id: `sys_${Date.now()}`,
        role: "assistant",
        content: `**${result.domain}** has been registered successfully. The domain is now in your Meter account. DNS settings can be managed through Porkbun.`,
      });
    }
  }

  return (
    <div
      className={`my-3 rounded-lg border overflow-hidden transition-colors ${
        isPurchased
          ? "border-emerald-500/30 bg-emerald-500/5"
          : isSkipped
            ? "border-border/50 opacity-60"
            : "border-border"
      }`}
    >
      {/* Header row: type badge + availability + tld */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
            Domain
          </span>
          {isAvailable && isPending && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-500/80">
              Available
            </span>
          )}
          {!isAvailable && !isPurchased && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-red-400/80">
              Taken
            </span>
          )}
          {isPremium && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-amber-400/80">
              Premium
            </span>
          )}
          {isPurchased && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-500/80">
              Purchased
            </span>
          )}
          {isSkipped && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
              Skipped
            </span>
          )}
        </div>
        {tld && (
          <span className="font-mono text-[10px] text-muted-foreground/40">.{tld}</span>
        )}
      </div>

      {/* Domain name + price */}
      <div className="flex items-start justify-between gap-3 px-3 pb-2">
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium text-foreground">{card.title}</div>
          {card.description && (
            <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
              {card.description}
            </div>
          )}
        </div>
        {card.cost !== undefined && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm text-foreground">
              ${card.cost.toFixed(2)}
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/40">/yr</div>
          </div>
        )}
      </div>

      {/* Renewal price */}
      {renewalPrice && renewalPrice !== "" && (
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground/50">Renewal</span>
            <span className="font-mono text-[10px] text-muted-foreground">${renewalPrice}/yr</span>
          </div>
        </div>
      )}

      {/* Purchase success message */}
      {isPurchased && (
        <div className="border-t border-emerald-500/20 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 text-emerald-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            <span className="font-mono text-[11px] text-emerald-500/80">
              {card.title} is yours
            </span>
          </div>
        </div>
      )}

      {/* Buy / Skip buttons */}
      {isPending && isAvailable && (
        <div className="border-t border-border px-3 py-2.5 flex items-center gap-2">
          <button
            onClick={handleBuy}
            disabled={loading}
            className="flex-1 rounded-md bg-foreground px-3 py-1.5 font-mono text-[11px] text-background transition-colors hover:bg-foreground/90 disabled:opacity-50"
          >
            {loading ? "Registering..." : `Buy Now $${card.cost?.toFixed(2)}`}
          </button>
          <button
            onClick={() => rejectCard(messageId, card.id)}
            disabled={loading}
            className="rounded-md px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Skip
          </button>
        </div>
      )}

      {/* Unavailable domain — no actions */}
      {!isAvailable && !isPurchased && !isSkipped && (
        <div className="border-t border-border px-3 py-2 text-center">
          <span className="font-mono text-[10px] text-muted-foreground/50">
            Not available for registration
          </span>
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="border-t border-red-500/20 bg-red-500/5 px-3 py-2.5">
          <div className="flex items-center gap-1.5">
            <svg className="h-3.5 w-3.5 shrink-0 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2.5}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
            <span className="font-mono text-[10px] text-red-400">{error}</span>
          </div>
        </div>
      )}
    </div>
  );
}
