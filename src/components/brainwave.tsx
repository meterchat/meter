"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import dynamic from "next/dynamic";

const Liveline = dynamic(() => import("liveline").then((m) => m.Liveline), {
  ssr: false,
  loading: () => <div className="h-[18px]" />,
});

/**
 * Brainwave — a compact heartbeat line that sits below the model picker.
 * Driven by token arrival bursts during streaming. Flatlines when idle.
 * Color matches the active model — feels like the model's neural activity.
 *
 * The parent pushes token deltas via the `push` ref callback.
 */

export interface BrainwaveHandle {
  /** Call with number of tokens received in this chunk */
  push: (tokens: number) => void;
}

const WINDOW_SECS = 30;

/** Dim a hex color to ~30% opacity equivalent for idle state */
function dimColor(hex: string): string {
  // Parse hex
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Blend toward dark background (#0a0a0a ≈ 10,10,10) at 30%
  const blend = (c: number, bg: number) => Math.round(bg + (c - bg) * 0.3);
  const dr = blend(r, 10);
  const dg = blend(g, 10);
  const db = blend(b, 10);
  return `#${dr.toString(16).padStart(2, "0")}${dg.toString(16).padStart(2, "0")}${db.toString(16).padStart(2, "0")}`;
}

export function Brainwave({
  handleRef,
  activeColor,
  streaming = false,
}: {
  handleRef: React.MutableRefObject<BrainwaveHandle | null>;
  activeColor: string;
  /** Keep the line "lit" (active color) for the entire duration of a response */
  streaming?: boolean;
}) {
  const [data, setData] = useState<{ time: number; value: number }[]>([]);
  const [currentRate, setCurrentRate] = useState(0);
  const tokenBucketRef = useRef(0);

  // Expose push to parent
  const push = useCallback((tokens: number) => {
    tokenBucketRef.current += tokens;
  }, []);

  useEffect(() => {
    handleRef.current = { push };
    return () => { handleRef.current = null; };
  }, [handleRef, push]);

  // Tick every 500ms — sample the token bucket and emit a rate
  useEffect(() => {
    const now = Math.floor(Date.now() / 1000);
    setData([{ time: now - 5, value: 0 }, { time: now, value: 0 }]);

    const interval = setInterval(() => {
      const nowSec = Math.floor(Date.now() / 1000);
      const tokens = tokenBucketRef.current;
      tokenBucketRef.current = 0;

      // tokens per 0.5s → tokens per second
      const rate = tokens * 2;
      setCurrentRate(rate);
      setData((d) => {
        const next = [...d, { time: nowSec, value: rate }];
        const cutoff = nowSec - WINDOW_SECS;
        return next.filter((p) => p.time >= cutoff);
      });
    }, 500);

    return () => clearInterval(interval);
  }, []);

  // Color: active color while streaming or tokens flowing, dimmed only when fully idle
  const isActive = streaming || currentRate > 0;
  const color = isActive ? activeColor : dimColor(activeColor);

  return (
    <div className="h-[18px] w-full relative overflow-hidden -my-px">
      <Liveline
        data={data}
        value={currentRate}
        window={WINDOW_SECS}
        theme="dark"
        color={color}
        fill
        pulse
        exaggerate
        momentum={false}
        scrub={false}
        grid={false}
        badge={false}
        padding={{ top: 0, right: 8, bottom: 0, left: 8 }}
        className="!bg-transparent !border-none"
        style={{ border: "none" }}
      />
    </div>
  );
}
