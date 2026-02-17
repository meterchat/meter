"use client";

import { ActionCard as ActionCardType } from "@/lib/store";

const TYPE_LABELS: Record<string, string> = {
  domain: "Domain",
  service: "Service",
  action: "Action",
};

export function ActionCard({
  card,
  onApprove,
  onReject,
}: {
  card: ActionCardType;
  onApprove: () => void;
  onReject: () => void;
}) {
  const isResolved = card.status !== "pending";

  return (
    <div className="my-3 rounded-lg border border-border p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-1">
            <span className="font-mono text-[9px] uppercase tracking-wider text-muted-foreground/50">
              {TYPE_LABELS[card.type] ?? card.type}
            </span>
            {card.status === "approved" && (
              <span className="font-mono text-[9px] text-emerald-500/80">approved</span>
            )}
            {card.status === "rejected" && (
              <span className="font-mono text-[9px] text-red-400/80">declined</span>
            )}
          </div>
          <div className="text-sm font-medium text-foreground">{card.title}</div>
          <div className="text-xs text-muted-foreground mt-0.5 leading-relaxed">
            {card.description}
          </div>
        </div>

        {card.cost !== undefined && (
          <div className="shrink-0 text-right">
            <div className="font-mono text-sm text-foreground">
              ${card.cost.toFixed(2)}
            </div>
            {card.status === "approved" && (
              <div className="font-mono text-[9px] text-yellow-500/70">pending</div>
            )}
          </div>
        )}
      </div>

      {!isResolved && (
        <div className="flex items-center gap-2 mt-3 pt-2 border-t border-border">
          <button
            onClick={onApprove}
            className="flex-1 rounded-md border border-foreground/20 px-3 py-1.5 font-mono text-[11px] text-foreground transition-colors hover:bg-foreground/10"
          >
            Approve
          </button>
          <button
            onClick={onReject}
            className="rounded-md px-3 py-1.5 font-mono text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          >
            Decline
          </button>
        </div>
      )}

      {card.metadata && Object.keys(card.metadata).length > 0 && (
        <div className="mt-2 pt-2 border-t border-border space-y-0.5">
          {Object.entries(card.metadata).map(([key, value]) => (
            <div key={key} className="flex items-center justify-between">
              <span className="font-mono text-[10px] text-muted-foreground/60">{key}</span>
              <span className="font-mono text-[10px] text-muted-foreground">{value}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
