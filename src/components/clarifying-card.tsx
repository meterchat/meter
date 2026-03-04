"use client";

import { useState } from "react";
import type { ClarifyingQuestion } from "@/lib/store";

interface ClarifyingCardProps {
  questions: ClarifyingQuestion[];
  messageId: string;
  onSubmit: (answers: Record<string, string>) => void;
  disabled?: boolean;
}

export function ClarifyingCard({ questions, messageId, onSubmit, disabled }: ClarifyingCardProps) {
  const question = questions[0];
  if (!question) return null;

  const isSubmitted = !!question.answer && disabled;
  const [answer, setAnswer] = useState(question.answer ?? "");

  const canSubmit = answer.trim().length > 0;

  function handleSubmit() {
    if (!canSubmit) return;
    onSubmit({ [question.id]: answer });
  }

  return (
    <div className="my-3 rounded-lg border border-blue-500/20 bg-blue-500/[0.03] overflow-hidden">
      <div className="px-3 py-3">
        {/* Question */}
        <p className="text-[12px] text-foreground/80 mb-2">
          {question.question}
        </p>

        {isSubmitted ? (
          <p className="text-[12px] text-foreground/80 font-mono bg-foreground/[0.03] rounded px-2 py-1.5">
            {question.answer}
          </p>
        ) : (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={answer}
              onChange={(e) => setAnswer(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSubmit) handleSubmit();
              }}
              disabled={disabled}
              placeholder="Your answer..."
              autoFocus
              className="flex-1 rounded border border-foreground/10 bg-background px-2 py-1.5 text-[12px] text-foreground placeholder:text-muted-foreground/40 focus:border-blue-500/40 focus:outline-none focus:ring-1 focus:ring-blue-500/20 disabled:opacity-50"
            />
            <button
              onClick={handleSubmit}
              disabled={!canSubmit || disabled}
              className="inline-flex items-center gap-1.5 rounded-lg border border-blue-500/30 bg-blue-500/10 px-3 py-1.5 font-mono text-[11px] text-blue-400 transition-colors hover:bg-blue-500/20 hover:text-blue-300 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <svg
                width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
              >
                <path d="M5 12h14" />
                <path d="m12 5 7 7-7 7" />
              </svg>
              Go
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
