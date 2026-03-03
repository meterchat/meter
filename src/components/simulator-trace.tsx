"use client";

import { useState } from "react";
import type { SimulatorTurn } from "@/lib/store";
import { SIMULATOR_PERSONAS, type SimulatorPersona } from "@/lib/simulate";

const PERSONA_MAP: Record<SimulatorPersona, { label: string; color: string }> = Object.fromEntries(
  SIMULATOR_PERSONAS.map((p) => [p.id, { label: p.label, color: p.color }]),
) as Record<SimulatorPersona, { label: string; color: string }>;

interface SimulatorTraceProps {
  /** Completed turns */
  trace: SimulatorTurn[];
  /** Currently streaming turn (null when not streaming) */
  activeTurn?: { persona: string; content: string } | null;
  /** Current simulator phase */
  phase?: "simulating" | "synthesizing" | null;
}

export function SimulatorTrace({ trace, activeTurn, phase }: SimulatorTraceProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isLive = phase === "simulating" || phase === "synthesizing";
  const allTurns = activeTurn
    ? [...trace, { persona: activeTurn.persona as SimulatorPersona, content: activeTurn.content }]
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
          className={`text-purple-500/60 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="font-mono text-[10px] text-purple-500/70 uppercase tracking-wider">
          {isLive ? (
            <span className="thinking-shimmer">
              {phase === "synthesizing" ? "Conviction" : "Simulating"}
            </span>
          ) : (
            "Simulation"
          )}
        </span>
        {/* Persona dots */}
        <span className="flex items-center gap-1 ml-1">
          {SIMULATOR_PERSONAS.map((p) => (
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
        <div className="border-l-2 border-purple-500/20 pl-4 space-y-3">
          {allTurns.map((turn, i) => {
            const persona = PERSONA_MAP[turn.persona] ?? { label: turn.persona, color: "#8B5CF6" };
            const isActive = activeTurn && i === allTurns.length - 1;
            return (
              <div key={`${turn.persona}-${i}`} className="text-xs text-muted-foreground/70">
                {/* Persona label */}
                <span
                  className={`font-mono text-[10px] font-medium ${isActive ? "thinking-shimmer" : ""}`}
                  style={{ color: persona.color }}
                >
                  {persona.label}
                </span>
                {/* Content */}
                <p className="mt-1 italic leading-relaxed whitespace-pre-wrap">
                  {turn.content}
                  {isActive && (
                    <span className="inline-block w-1.5 h-3.5 bg-purple-500/50 ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            );
          })}

          {/* Synthesizing indicator */}
          {phase === "synthesizing" && (
            <div className="text-xs">
              <span className="font-mono text-[10px] text-purple-500/70 thinking-shimmer">
                Simulator 1.0 — Scoring conviction
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Small inline persona dots for the receipt footer */
export function SimulatorPersonaDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" title={SIMULATOR_PERSONAS.map((p) => p.label).join(" + ")}>
      {SIMULATOR_PERSONAS.map((p) => (
        <span
          key={p.id}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: p.color }}
        />
      ))}
    </span>
  );
}
