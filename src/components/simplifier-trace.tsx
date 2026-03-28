"use client";

import type { SimplifierTurn } from "@/lib/store";
import { SIMPLIFIER_PERSONAS, type SimplifierPersona } from "@/lib/simplify";

/** Status labels shown during each pass */
const PASS_STATUS: Record<SimplifierPersona, string> = {
  assumptions: "Counting assumptions",
  razor: "Applying the razor",
  output: "Rebuilding from minimum",
};

interface SimplifierTraceProps {
  trace: SimplifierTurn[];
  activeTurn?: { persona: string; content: string } | null;
  phase?: "simplifying" | "synthesizing" | null;
}

export function SimplifierTrace({ trace, activeTurn, phase }: SimplifierTraceProps) {
  const isLive = phase === "simplifying" || phase === "synthesizing";
  const activePersona = activeTurn?.persona as SimplifierPersona | undefined;

  const completedPersonas = trace.map((t) => t.persona);

  if (completedPersonas.length === 0 && !isLive) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        <span className="flex items-center gap-1">
          {SIMPLIFIER_PERSONAS.map((p) => {
            const done = completedPersonas.includes(p.id);
            const active = activePersona === p.id;
            return (
              <span
                key={p.id}
                className={`h-1.5 w-1.5 rounded-full transition-opacity ${!done && !active ? "opacity-30" : ""}`}
                style={{ backgroundColor: p.color }}
                title={p.label}
              />
            );
          })}
        </span>
        <span className="font-mono text-[10px] text-amber-500/70 uppercase tracking-wider">
          {isLive ? (
            <span className="thinking-shimmer">
              {phase === "synthesizing" ? "Output" : "Simplifying"}
            </span>
          ) : (
            "Simplified"
          )}
        </span>
      </div>

      {isLive && (
        <div className="space-y-1.5 ml-0.5">
          {SIMPLIFIER_PERSONAS.map((p) => {
            const done = completedPersonas.includes(p.id);
            const active = activePersona === p.id;
            if (!done && !active) return null;

            return (
              <div key={p.id} className="flex items-center gap-2 text-[11px]">
                {done ? (
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke={p.color} strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                ) : (
                  <span className="h-2.5 w-2.5 shrink-0 flex items-center justify-center">
                    <span className="h-1.5 w-1.5 rounded-full animate-pulse" style={{ backgroundColor: p.color }} />
                  </span>
                )}
                <span
                  className={`font-mono ${active ? "thinking-shimmer" : "text-muted-foreground/50"}`}
                  style={active ? { color: p.color } : undefined}
                >
                  {PASS_STATUS[p.id]}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
