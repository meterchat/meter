"use client";

import { useDecisionsStore } from "@/lib/decisions-store";

export function DecisionsBar() {
  const { decisions, panelOpen, togglePanel } = useDecisionsStore();
  const undecidedCount = decisions.filter((d) => d.status === "undecided").length;

  return (
    <button
      onClick={togglePanel}
      className="flex w-full items-center justify-between px-3 py-2 hover:bg-foreground/[0.03] transition-colors"
    >
      <div className="flex items-center gap-1.5">
        <span className="font-mono text-[11px] text-muted-foreground">Decisions</span>
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          strokeLinecap="round"
          strokeLinejoin="round"
          className={`text-muted-foreground/60 transition-transform duration-200 ${panelOpen ? "rotate-180" : ""}`}
        >
          <polyline points="18 15 12 9 6 15" />
        </svg>
      </div>
      <div className="flex items-center gap-1.5">
        {undecidedCount > 0 && (
          <>
            <svg
              width="10"
              height="10"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="text-amber-500"
            >
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
            </svg>
            <span className="font-mono text-[10px] text-muted-foreground/60">
              {undecidedCount} open
            </span>
          </>
        )}
        {undecidedCount === 0 && decisions.length > 0 && (
          <span className="font-mono text-[10px] text-muted-foreground/40">
            {decisions.length} total
          </span>
        )}
      </div>
    </button>
  );
}
