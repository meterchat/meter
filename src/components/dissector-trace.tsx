"use client";

import { useState } from "react";
import type { DissectorTurn } from "@/lib/store";
import { DISSECTOR_PERSONAS, type DissectorPersona } from "@/lib/dissect";

const PERSONA_MAP: Record<DissectorPersona, { label: string; color: string }> = Object.fromEntries(
  DISSECTOR_PERSONAS.map((p) => [p.id, { label: p.label, color: p.color }]),
) as Record<DissectorPersona, { label: string; color: string }>;

interface DissectorTraceProps {
  trace: DissectorTurn[];
  activeTurn?: { persona: string; content: string } | null;
  phase?: "dissecting" | "synthesizing" | null;
}

export function DissectorTrace({ trace, activeTurn, phase }: DissectorTraceProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isLive = phase === "dissecting" || phase === "synthesizing";
  const allTurns = activeTurn
    ? [...trace, { persona: activeTurn.persona as DissectorPersona, content: activeTurn.content }]
    : trace;

  if (allTurns.length === 0 && !isLive) return null;

  return (
    <div className="mb-3">
      {/* Header */}
      <button
        onClick={() => setCollapsed((v) => !v)}
        className="flex items-center gap-2 mb-2 group"
      >
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none"
          stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          className={`text-blue-500/60 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="font-mono text-[10px] text-blue-500/70 uppercase tracking-wider">
          {isLive ? (
            <span className="thinking-shimmer">
              {phase === "synthesizing" ? "Verdict" : "Dissecting"}
            </span>
          ) : (
            "Dissection"
          )}
        </span>
        {/* Persona dots */}
        <span className="flex items-center gap-1 ml-1">
          {DISSECTOR_PERSONAS.map((p) => (
            <span
              key={p.id}
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: p.color }}
              title={p.label}
            />
          ))}
        </span>
      </button>

      {/* Trace body */}
      {!collapsed && (
        <div className="border-l-2 border-blue-500/20 pl-4 space-y-3">
          {allTurns.map((turn, i) => {
            const persona = PERSONA_MAP[turn.persona] ?? { label: turn.persona, color: "#3B82F6" };
            const isActive = activeTurn && i === allTurns.length - 1;
            return (
              <div key={`${turn.persona}-${i}`} className="text-xs text-muted-foreground/70">
                <span
                  className={`font-mono text-[10px] font-medium ${isActive ? "thinking-shimmer" : ""}`}
                  style={{ color: persona.color }}
                >
                  {persona.label}
                </span>
                <p className="mt-1 italic leading-relaxed whitespace-pre-wrap">
                  {turn.content}
                  {isActive && (
                    <span className="inline-block w-1.5 h-3.5 bg-blue-500/50 ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            );
          })}

          {phase === "synthesizing" && (
            <div className="text-xs">
              <span className="font-mono text-[10px] text-blue-500/70 thinking-shimmer">
                Dissector 1.0 — Rendering verdict
              </span>
            </div>
          )}
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
