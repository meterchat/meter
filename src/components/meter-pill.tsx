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
  onClick?: () => void;
  value?: number;
  tokens?: number;
}

export function MeterPill({ onClick, value, tokens }: MeterPillProps) {
  const { projects, activeProjectId } = useMeterStore();
  const activeProject = projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const today = value ?? activeProject?.todayCost ?? 0;
  const todayTokens = tokens ?? (activeProject?.todayTokensIn ?? 0) + (activeProject?.todayTokensOut ?? 0);
  const isStreaming = activeProject?.isStreaming ?? false;
  const animatedToday = useAnimatedNumber(today);

  // Show more precision while streaming so digits visibly tick
  const costStr = isStreaming
    ? `$${animatedToday.toFixed(4)}`
    : `$${animatedToday.toFixed(2)}`;

  return (
    <button
      onClick={onClick}
      className="flex items-center gap-2 rounded-lg border border-border px-2.5 py-1.5 font-mono text-muted-foreground transition-colors hover:border-foreground/20 hover:text-foreground"
      title="Open usage drawer"
    >
      <MeterIcon active={isStreaming} size={16} />
      <span className="text-[12px] text-foreground tabular-nums">
        {costStr}
      </span>
      {isStreaming && todayTokens > 0 ? (
        <span className="text-[10px] text-muted-foreground/60 tabular-nums">
          {todayTokens.toLocaleString()} tkn
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/50">
          {todayTokens.toLocaleString()} tkn
        </span>
      )}
    </button>
  );
}
