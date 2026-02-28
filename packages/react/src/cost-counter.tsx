import React from "react";

interface CostCounterProps {
  /** Total session cost in dollars */
  cost: number;
  /** Current message cost (during streaming) */
  currentCost?: number;
  /** CSS class */
  className?: string;
}

export function CostCounter({ cost, currentCost = 0, className }: CostCounterProps) {
  const total = cost + currentCost;
  const display = total < 0.01 && total > 0
    ? `<$0.01`
    : `$${total.toFixed(2)}`;

  return (
    <span
      className={className}
      style={{
        fontFamily: "monospace",
        fontSize: "13px",
        color: "var(--meter-text-secondary, #888)",
        ...(!className ? { padding: "4px 8px" } : {}),
      }}
    >
      {display}
    </span>
  );
}
