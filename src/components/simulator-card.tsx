"use client";

import { useState } from "react";
import type { SimulatorQuestion } from "@/lib/store";

interface SimulatorCardProps {
  questions: SimulatorQuestion[];
  messageId: string;
  onSubmit: (answers: Record<string, string>) => void;
  disabled?: boolean;
}

export function SimulatorCard({ questions, messageId, onSubmit, disabled }: SimulatorCardProps) {
  const allAnswered = questions.every((q) => q.answer && q.answer.trim().length > 0);
  const isSubmitted = allAnswered && disabled;
  const [localAnswers, setLocalAnswers] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const q of questions) {
      init[q.id] = q.answer ?? "";
    }
    return init;
  });

  const canSubmit = Object.values(localAnswers).every((a) => a.trim().length > 0);

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit(localAnswers);
  }

  return (
    <div className="my-3 rounded-lg border border-purple-500/20 bg-purple-500/[0.03] overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-3 pt-3 pb-2">
        <svg
          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className="text-purple-400"
        >
          <circle cx="12" cy="12" r="10" />
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="font-mono text-[10px] uppercase tracking-wider text-purple-400/80">
          Clarifying Questions
        </span>
      </div>

      {/* Questions */}
      <div className="px-3 pb-3 space-y-3">
        {questions.map((q, i) => (
          <div key={q.id}>
            <label className="block text-[12px] text-foreground/80 mb-1">
              {i + 1}. {q.question}
            </label>
            {isSubmitted ? (
              <p className="text-[12px] text-foreground/60 font-mono bg-foreground/[0.03] rounded px-2 py-1.5">
                {q.answer}
              </p>
            ) : (
              <input
                type="text"
                value={localAnswers[q.id] ?? ""}
                onChange={(e) =>
                  setLocalAnswers((prev) => ({ ...prev, [q.id]: e.target.value }))
                }
                onKeyDown={(e) => {
                  if (e.key === "Enter" && canSubmit) handleSubmit();
                }}
                disabled={disabled}
                placeholder="Your answer..."
                className="w-full rounded border border-foreground/10 bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:border-purple-500/40 focus:outline-none focus:ring-1 focus:ring-purple-500/20 disabled:opacity-50"
              />
            )}
          </div>
        ))}

        {/* Submit button */}
        {!isSubmitted && (
          <button
            onClick={handleSubmit}
            disabled={!canSubmit || disabled}
            className="mt-1 inline-flex items-center gap-1.5 rounded-lg border border-purple-500/30 bg-purple-500/10 px-3 py-1.5 font-mono text-[11px] text-purple-400 transition-colors hover:bg-purple-500/20 hover:text-purple-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <svg
              width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
              strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
            >
              <path d="M5 12h14" />
              <path d="m12 5 7 7-7 7" />
            </svg>
            Run Analysis
          </button>
        )}

        {isSubmitted && (
          <div className="flex items-center gap-1.5 text-[10px] text-purple-400/60 font-mono">
            <span className="inline-block h-1.5 w-1.5 rounded-full bg-purple-400/60 animate-pulse" />
            Analysis running...
          </div>
        )}
      </div>
    </div>
  );
}
