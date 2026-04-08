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
// idle     → just the icon, counter hidden
// resetting → counter expanding, digits cascading to 0
// streaming → counter visible, digits rolling with cost
// settling  → stream ended, finalizeResponse rolls in, icon still spinning
// locked   → counter greyed out briefly, about to retract
// idle     → counter retracted, back to icon only
type Phase = "idle" | "resetting" | "streaming" | "settling" | "locked";

/* ── MeterPill ─────────────────────────────────────────────────────── */
export function MeterPill() {
  const { sessions, activeSessionId } = useMeterStore();
  const active =
    sessions.find((p) => p.id === activeSessionId) ?? sessions[0];
  const isStreaming = active?.isStreaming ?? false;
  const rawCost = active?.currentMessageCost ?? 0;
  const todayCost = active?.todayCost ?? 0;

  const [phase, setPhase] = useState<Phase>("idle");
  const [displayCost, setDisplayCost] = useState(0);
  const maxCostRef = useRef(0);
  const wasStreamingRef = useRef(false);
  const resetTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const prevProjectRef = useRef(activeSessionId);

  /* Reset when switching workspaces */
  useEffect(() => {
    if (activeSessionId !== prevProjectRef.current) {
      setPhase("idle");
      setDisplayCost(0);
      maxCostRef.current = 0;
      wasStreamingRef.current = false;
      prevProjectRef.current = activeSessionId;
    }
  }, [activeSessionId]);

  /* Detect streaming start / stop */
  useEffect(() => {
    if (isStreaming && !wasStreamingRef.current) {
      clearTimeout(resetTimerRef.current);
      setPhase("resetting");
      setDisplayCost(0);
      maxCostRef.current = 0;
      wasStreamingRef.current = true;

      resetTimerRef.current = setTimeout(() => {
        setPhase("streaming");
        setDisplayCost(maxCostRef.current);
      }, 300);
    }
    if (!isStreaming && wasStreamingRef.current) {
      clearTimeout(resetTimerRef.current);
      setPhase("settling");
      wasStreamingRef.current = false;

      // settling → locked (greyed) → idle (retract)
      resetTimerRef.current = setTimeout(() => {
        setPhase("locked");
        resetTimerRef.current = setTimeout(() => {
          setPhase("idle");
        }, 1500);
      }, 600);
    }
    return () => clearTimeout(resetTimerRef.current);
  }, [isStreaming]); // eslint-disable-line react-hooks/exhaustive-deps

  /* Monotonic cost updates — buffer during reset, apply during stream/settling */
  useEffect(() => {
    const clamped = Math.max(0, rawCost);
    if (phase === "streaming" || phase === "settling") {
      const next = Math.max(maxCostRef.current, clamped);
      maxCostRef.current = next;
      setDisplayCost(next);
    } else if (phase === "resetting") {
      maxCostRef.current = Math.max(maxCostRef.current, clamped);
    }
  }, [rawCost, phase]);

  /* Counter visibility: icon-only when idle, expand during streaming */
  const showCounter = phase !== "idle";

  const visibleCost = displayCost;
  const decimalPlaces = 4;

  const formatted = visibleCost.toFixed(decimalPlaces);
  const [intPart, decPart] = formatted.split(".");
  const intDigits = intPart.split("").map(Number);
  const decDigits = decPart.split("").map(Number);

  const isResetting = phase === "resetting";
  const animate = phase === "resetting" || phase === "streaming" || phase === "settling";
  const duration = isResetting ? 250 : phase === "settling" ? 350 : 150;
  const cascadeStep = isResetting ? 20 : 0;

  const iconActive = phase === "streaming" || phase === "resetting" || phase === "settling";

  let digitIdx = 0;

  return (
    <div
      className={`flex shrink-0 items-center overflow-hidden rounded-lg border font-mono transition-all duration-300 ease-in-out ${
        phase === "idle"
          ? "gap-2 border-border/50 px-2.5 py-1.5 text-muted-foreground/70"
          : phase === "locked"
            ? "gap-2 border-border px-2.5 py-1.5 text-muted-foreground/60"
            : "gap-2 border-border px-2.5 py-1.5 text-muted-foreground hover:border-foreground/20 hover:text-foreground"
      }`}
      title="Message cost"
    >
      <MeterIcon active={iconActive} size={16} />
      {showCounter && (
        <>
          <span
            className={`text-[12px] leading-none tabular-nums inline-flex items-center transition-opacity duration-300 ${
              phase === "idle"
                ? "text-muted-foreground/70"
                : phase === "locked"
                  ? "text-muted-foreground/40"
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
        </>
      )}
    </div>
  );
}
