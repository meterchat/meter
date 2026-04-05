"use client";

import { useState } from "react";

export function StatusBanner() {
  const [dismissed, setDismissed] = useState(false);

  if (dismissed) return null;

  return (
    <div className="border-b border-amber-500/20 bg-amber-500/5 px-4 py-1.5">
      <div className="mx-auto flex items-center justify-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
        <p className="font-mono text-[11px] text-foreground/70">
          Intermittent issues with message persistence. Chats may be lost on refresh or logout — copy or export locally. Fix in progress.
        </p>
        <button
          onClick={() => setDismissed(true)}
          className="ml-1 shrink-0 rounded p-0.5 text-foreground/40 transition-colors hover:text-foreground/70"
          aria-label="Dismiss"
        >
          <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <line x1="18" y1="6" x2="6" y2="18" />
            <line x1="6" y1="6" x2="18" y2="18" />
          </svg>
        </button>
      </div>
    </div>
  );
}
