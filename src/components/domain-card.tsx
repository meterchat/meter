"use client";

import { ActionCard as ActionCardType } from "@/lib/store";

interface DomainCardProps {
  card: ActionCardType;
  messageId: string;
}

export function DomainCard({ card }: DomainCardProps) {
  const isAvailable = card.metadata?.available === "true";
  const isPremium = card.metadata?.premium === "true";
  const renewalPrice = card.metadata?.renewalPrice;
  const tld = card.metadata?.tld ?? card.title.split(".").pop();

  return (
    <div className="my-3 rounded-lg border overflow-hidden border-border">
      {/* Header row: type badge + availability + tld */}
      <div className="flex items-center justify-between px-3 pt-3 pb-1">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
            Domain
          </span>
          {isAvailable && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-emerald-500/80">
              Available
            </span>
          )}
          {!isAvailable && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-red-400/80">
              Taken
            </span>
          )}
          {isPremium && (
            <span className="font-mono text-[9px] uppercase tracking-wider text-amber-400/80">
              Premium
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
        {isAvailable && card.cost !== undefined && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm text-foreground">
              ${card.cost.toFixed(2)}
            </div>
            <div className="font-mono text-[9px] text-muted-foreground/40">/yr</div>
          </div>
        )}
      </div>

      {/* Renewal price */}
      {isAvailable && renewalPrice && renewalPrice !== "" && (
        <div className="px-3 pb-2">
          <div className="flex items-center justify-between">
            <span className="font-mono text-[10px] text-muted-foreground/50">Renewal</span>
            <span className="font-mono text-[10px] text-muted-foreground">${renewalPrice}/yr</span>
          </div>
        </div>
      )}

      {/* Unavailable domain */}
      {!isAvailable && (
        <div className="border-t border-border px-3 py-2 text-center">
          <span className="font-mono text-[10px] text-muted-foreground/50">
            Not available for registration
          </span>
        </div>
      )}
    </div>
  );
}
