"use client";

import { useState, useRef, useEffect } from "react";
import { useMeterStore } from "@/lib/store";
import { MODES } from "@/lib/modes";
import type { AgentMode } from "@/lib/modes";

export function ModeSwitcher() {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const activeProjectId = useMeterStore((s) => s.activeProjectId);
  const setActiveProject = useMeterStore((s) => s.setActiveProject);

  const activeMode = MODES.find((m) => m.id === activeProjectId) ?? MODES[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  const handleSelect = (id: AgentMode) => {
    setActiveProject(id);
    setOpen(false);
  };

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className="flex items-center gap-1.5 font-mono text-[11px] text-muted-foreground hover:text-foreground transition-colors"
      >
        <span
          className="h-1.5 w-1.5 rounded-full"
          style={{ backgroundColor: activeMode.color }}
        />
        <span>{activeMode.name}</span>
        <svg
          width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          className={`transition-transform duration-200 ${open ? "rotate-180" : ""}`}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {open && (
        <div className="absolute bottom-full right-0 mb-2 w-56 rounded-md border border-border bg-popover p-2 shadow-md z-50">
          <div className="font-mono text-[10px] text-muted-foreground/60 uppercase tracking-wider px-2 py-1">
            Mode
          </div>
          {MODES.map((mode) => (
            <button
              key={mode.id}
              onClick={() => handleSelect(mode.id)}
              className={`flex w-full items-start gap-2.5 rounded-md px-2 py-2 font-mono text-[11px] transition-colors ${
                mode.id === activeMode.id
                  ? "bg-foreground/10 text-foreground"
                  : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
              }`}
            >
              <span
                className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{ backgroundColor: mode.id === activeMode.id ? mode.color : "var(--muted-foreground)" }}
              />
              <div className="min-w-0 text-left">
                <div className="font-medium">{mode.name}</div>
                <div className="text-[10px] text-muted-foreground/50 leading-snug">
                  {mode.description}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
