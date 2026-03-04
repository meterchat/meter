"use client";

import type { DissectorTurn } from "@/lib/store";
import { DISSECTOR_PERSONAS, type DissectorPersona } from "@/lib/dissect";

/** Status labels shown during each pass — brief, not the full thought */
const PASS_STATUS: Record<DissectorPersona, string> = {
  "first-principles": "Thinking from first principles",
  "inversion": "Inverting — what kills this?",
  "pre-mortem": "Running pre-mortem",
  "verdict": "Rendering verdict",
};

interface DissectorTraceProps {
  trace: DissectorTurn[];
  activeTurn?: { persona: string; content: string } | null;
  phase?: "dissecting" | "synthesizing" | null;
}

export function DissectorTrace({ trace, activeTurn, phase }: DissectorTraceProps) {
  const isLive = phase === "dissecting" || phase === "synthesizing";
  const activePersona = activeTurn?.persona as DissectorPersona | undefined;

  // Completed pass personas
  const completedPersonas = trace.map((t) => t.persona);

  if (completedPersonas.length === 0 && !isLive) return null;

  return (
    <div className="mb-3">
      <div className="flex items-center gap-2 mb-2">
        {/* Persona dots */}
        <span className="flex items-center gap-1">
          {DISSECTOR_PERSONAS.map((p) => {
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
        <span className="font-mono text-[10px] text-blue-500/70 uppercase tracking-wider">
          {isLive ? (
            <span className="thinking-shimmer">
              {phase === "synthesizing" ? "Verdict" : "Dissecting"}
            </span>
          ) : (
            "Dissection"
          )}
        </span>
      </div>

      {/* Status lines — one per pass */}
      {isLive && (
        <div className="space-y-1.5 ml-0.5">
          {DISSECTOR_PERSONAS.map((p) => {
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
                  className={`font-mono ${active ? "thinking-shimmer" : "text-muted-foreground/70"}`}
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

export function DissectorPersonaDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" title={DISSECTOR_PERSONAS.map((p) => p.label).join(" + ")}>
      {DISSECTOR_PERSONAS.map((p) => (
        <span
          key={p.id}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: p.color }}
        />
      ))}
    </span>
  );
}
