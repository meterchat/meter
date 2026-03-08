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

  const color = activeColor;

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
