"use client";

import { useEffect, useRef, useState, memo } from "react";
import { useMeterStore } from "@/lib/store";
import { MeterIcon } from "./meter-icon";

/* ── Single slot digit: a column of 0-9 that rolls via translateY ── */

const SlotDigit = memo(function SlotDigit({
  digit,
  animate,
  delay,
  duration,
}: {
  digit: number;
  animate: boolean;
  delay: number;
  duration: number;
}) {
  return (
    <span
      className="inline-block overflow-hidden leading-none"
      style={{ height: "1em" }}
    >
      <span
        className="flex flex-col will-change-transform"
        style={{
          transform: `translateY(${-digit}em)`,
          transition: animate
            ? `transform ${duration}ms cubic-bezier(0.16, 1, 0.3, 1)`
            : "none",
          transitionDelay: animate ? `${delay}ms` : "0ms",
        }}
      >
        {Array.from({ length: 10 }, (_, n) => (
          <span
            key={n}
            className="flex items-center justify-center leading-none"
            style={{ height: "1em" }}
          >
            {n}
          </span>
        ))}
      </span>
    </span>
  );
});

/* ── Phases ────────────────────────────────────────────────────────── */
type Phase = "idle" | "resetting" | "streaming" | "locked";

/* ── MeterPill ─────────────────────────────────────────────────────── */
export function MeterPill() {
  const { projects, activeProjectId } = useMeterStore();
  const active =
    projects.find((p) => p.id === activeProjectId) ?? projects[0];
  const isStreaming = active?.isStreaming ?? false;
  const rawCost = active?.currentMessageCost ?? 0;

  const [phase, setPhase] = useState<Phase>("idle");
  const [displayCost, setDisplayCost] = useState(0);
  const maxCostRef = useRef(0);
  const wasStreamingRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevProjectRef = useRef(activeProjectId);

  /* Reset when switching workspaces */
  useEffect(() => {
    if (activeProjectId !== prevProjectRef.current) {
      setPhase("idle");
      setDisplayCost(0);
      maxCostRef.current = 0;
      wasStreamingRef.current = false;
      prevProjectRef.current = activeProjectId;
    }
  }, [activeProjectId]);

  /* Detect streaming start / stop */
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      // New message → cascade digits back to 0, then stream
      clearTimeout(resetTimerRef.current);
      setPhase("resetting");
      setDisplayCost(0);
      maxCostRef.current = 0;
      wasStreamingRef.current = true;

      resetTimerRef.current = setTimeout(() => {
        setPhase("streaming");
        // Apply any cost that accumulated during the reset animation
        setDisplayCost(maxCostRef.current);
      }, 300);
    }
    if (!isStreaming && wasStreamingRef.current) {
      clearTimeout(resetTimerRef.current);
      setPhase("locked");
      wasStreamingRef.current = false;
    }
    return () => clearTimeout(resetTimerRef.current);
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Monotonic cost updates — buffer during reset, apply during stream */
  useEffect(() => {
    const clamped = Math.max(0, rawCost);
    if (phase === "streaming") {
      const next = Math.max(maxCostRef.current, clamped);
      maxCostRef.current = next;
      setDisplayCost(next);
    } else if (phase === "resetting") {
      // Buffer while the cascade runs
      maxCostRef.current = Math.max(maxCostRef.current, clamped);
    }
  }, [rawCost, phase]);

  /* Dynamic decimal places: 4 while active, 2 when settled */
  const isActive = phase === "streaming" || phase === "resetting";
  const decimals = isActive ? 4 : 2;
  const formatted = displayCost.toFixed(decimals);
  const [intPart, decPart] = formatted.split(".");
  const intDigits = intPart.split("").map(Number);
  const decDigits = decPart.split("").map(Number);

  const isResetting = phase === "resetting";
  const animate = phase === "resetting" || phase === "streaming";
  const duration = isResetting ? 250 : 150;
  const cascadeStep = isResetting ? 20 : 0;

  let digitIdx = 0;

  return (
    <button
      className={`flex shrink-0 items-center gap-2 rounded-lg border px-2.5 py-1.5 font-mono transition-colors ${
        phase === "idle"
          ? "border-border/50 text-muted-foreground/40"
          : phase === "locked"
            ? "border-border text-muted-foreground/60"
            : "border-border text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      }`}
      title="Message cost"
    >
      <MeterIcon active={isStreaming} size={16} />
      <span
        className={`text-[12px] leading-none tabular-nums inline-flex items-center ${
          phase === "idle"
            ? "text-muted-foreground/30"
            : phase === "locked"
              ? "text-muted-foreground/60"
              : "text-foreground"
        }`}
      >
        <span>$</span>
        {intDigits.map((d, i) => (
          <SlotDigit
            key={`i${i}`}
            digit={d}
            animate={animate}
            delay={cascadeStep * digitIdx++}
            duration={duration}
          />
        ))}
        <span>.</span>
        {decDigits.map((d, i) => (
          <SlotDigit
            key={`d${i}`}
            digit={d}
            animate={animate}
            delay={cascadeStep * digitIdx++}
            duration={duration}
          />
        ))}
      </span>
      <span className="text-[10px] text-muted-foreground/50 uppercase tracking-wider">
        MSG
      </span>
    </button>
  );
}
