"use client";

import { useEffect, useRef, useState } from "react";
import { useMeterStore } from "@/lib/store";
import { MeterIcon } from "./meter-icon";

function useAnimatedNumber(value: number, duration = 350) {
  const [display, setDisplay] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    let raf = 0;
    const start = performance.now();
    const from = prevRef.current;
    const diff = value - from;

    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration);
      const next = from + diff * p;
      setDisplay(next);
      if (p < 1) {
        raf = requestAnimationFrame(tick);
      } else {
        prevRef.current = value;
      }
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value, duration]);

  return display;
}

interface MeterPillProps {
  value?: number;
}

export function MeterPill({ value }: MeterPillProps) {
  const { projects, activeProjectId } = useMeterStore();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const isStreaming = activeProject?.isStreaming ?? false;
  const messageCost = value ?? activeProject?.currentMessageCost ?? 0;

  // Phase tracks the display lifecycle:
  // idle: no active message, show $0.00 dimmed
  // streaming: AI is responding, show live cost
  // lingering: response complete, freeze cost for 2s before resetting
  const [phase, setPhase] = useState<"idle" | "streaming" | "lingering">("idle");
  const lingerTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (isStreaming) {
      clearTimeout(lingerTimer.current);
      setPhase("streaming");
    } else if (phase === "streaming") {
      // Streaming just stopped — linger to show the final cost
      setPhase("lingering");
      lingerTimer.current = setTimeout(() => {
        setPhase("idle");
      }, 2000);
    }
    return () => clearTimeout(lingerTimer.current);
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  const displayValue = phase === "idle" ? 0 : messageCost;
  const animatedCost = useAnimatedNumber(displayValue);
  const isIdle = phase === "idle";

  const costStr = phase === "streaming"
    ? `$${animatedCost.toFixed(4)}`
    : `$${animatedCost.toFixed(2)}`;

  return (
    <button
      className={`flex items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono transition-colors ${
        isIdle
          ? "border-border/50 text-muted-foreground/40"
          : phase === "lingering"
            ? "border-border text-muted-foreground/60"
            : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      }`}
      title="Message spend"
    >
      <MeterIcon active={isStreaming} size={16} />
      <span className={`text-[12px] tabular-nums ${
        isIdle
          ? "text-muted-foreground/30"
          : phase === "lingering"
            ? "text-muted-foreground/60"
            : "text-foreground"
      }`}>
        {costStr}
      </span>
      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
        MSG
      </span>
    </button>
  );
}
