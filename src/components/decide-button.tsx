"use client";

import { useMeterStore } from "@/lib/store";

export function DecideButton() {
  const decisionMode = useMeterStore((s) => s.decisionMode);
  const setDecisionMode = useMeterStore((s) => s.setDecisionMode);
  const isStreaming = useMeterStore((s) => {
    const p = s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0];
    return p?.isStreaming ?? false;
  });

  return (
    <button
      onClick={() => setDecisionMode(!decisionMode)}
      disabled={isStreaming}
      className={`flex h-8 items-center gap-1.5 rounded-lg border px-2.5 font-mono text-[11px] transition-all disabled:opacity-40 ${
        decisionMode
          ? "border-amber-500/50 bg-amber-500/10 text-amber-400"
          : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      }`}
      title={decisionMode ? "Decision mode active" : "Enter decision mode"}
    >
      <svg
        width="14"
        height="14"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M12 22c5.523 0 10-4.477 10-10S17.523 2 12 2 2 6.477 2 12s4.477 10 10 10z" />
        <path d="m9 12 2 2 4-4" />
      </svg>
      <span>Decide</span>
    </button>
  );
}
