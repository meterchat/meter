"use client";

import { useState } from "react";
import { getModel, shortModelName, DEBATE_MODELS } from "@/lib/models";
import type { DebateTurn } from "@/lib/store";

const PHASE_LABELS: Record<string, string> = {
  opening: "Opening",
  challenge: "Challenge",
  rebuttal: "Rebuttal",
  vote: "Vote",
};

interface DebateTraceProps {
  /** Completed turns */
  trace: DebateTurn[];
  /** Currently streaming turn (null when not streaming) */
  activeTurn?: { model: string; phase: string; content: string } | null;
  /** Current debate phase — null if not debating */
  phase?: "debating" | "synthesizing" | null;
}

export function DebateTrace({ trace, activeTurn, phase }: DebateTraceProps) {
  const [collapsed, setCollapsed] = useState(false);
  const isLive = phase === "debating" || phase === "synthesizing";
  const allTurns = activeTurn ? [...trace, activeTurn] : trace;

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
          className={`text-amber-500/60 transition-transform ${collapsed ? "-rotate-90" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
        <span className="font-mono text-[10px] text-amber-500/70 uppercase tracking-wider">
          {isLive ? (
            <span className="thinking-shimmer">
              {phase === "synthesizing" ? "Synthesizing" : "Debating"}
            </span>
          ) : (
            "Debate"
          )}
        </span>
        {/* Model dots */}
        <span className="flex items-center gap-1 ml-1">
          {DEBATE_MODELS.map((id) => (
            <span
              key={id}
              className="h-1.5 w-1.5 rounded-full"
              style={{ backgroundColor: getModel(id).color }}
              title={shortModelName(id)}
            />
          ))}
        </span>
      </button>

      {/* Trace body */}
      {!collapsed && (
        <div className="border-l-2 border-amber-500/20 pl-4 space-y-3">
          {allTurns.map((turn, i) => {
            const model = getModel(turn.model);
            const isActive = activeTurn && i === allTurns.length - 1;
            return (
              <div key={`${turn.model}-${turn.phase}-${i}`} className="text-xs text-muted-foreground/70">
                {/* Model label */}
                <span
                  className={`font-mono text-[10px] font-medium ${isActive ? "thinking-shimmer" : ""}`}
                  style={{ color: model.color }}
                >
                  {shortModelName(turn.model)}
                </span>
                <span className="font-mono text-[10px] text-muted-foreground/40 ml-1.5">
                  {PHASE_LABELS[turn.phase] ?? turn.phase}
                </span>
                {/* Content */}
                <p className="mt-1 italic leading-relaxed whitespace-pre-wrap">
                  {turn.content}
                  {isActive && (
                    <span className="inline-block w-1.5 h-3.5 bg-amber-500/50 ml-0.5 animate-pulse" />
                  )}
                </p>
              </div>
            );
          })}

          {/* Synthesizing indicator */}
          {phase === "synthesizing" && (
            <div className="text-xs">
              <span className="font-mono text-[10px] text-amber-500/70 thinking-shimmer">
                Parameter 1.0 — Synthesizing consensus
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** Small inline model dots for the receipt footer */
export function DebateModelDots() {
  return (
    <span className="inline-flex items-center gap-0.5 ml-1" title={DEBATE_MODELS.map(shortModelName).join(" + ")}>
      {DEBATE_MODELS.map((id) => (
        <span
          key={id}
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: getModel(id).color }}
        />
      ))}
    </span>
  );
}
