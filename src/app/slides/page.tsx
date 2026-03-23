"use client";

import { useState, useEffect } from "react";
import { LiveMeterPill, LiveModelGrid, LiveDebateTrace, LiveDecisionCard } from "@/components/landing-page";
import { BoxPrivacy } from "@/components/feature-boxes";

// BoxPrivacy only runs once (idle→verifying→verified), so loop it
function LoopingBoxPrivacy() {
  const [active, setActive] = useState(true);
  useEffect(() => {
    const interval = setInterval(() => {
      setActive(false);
      setTimeout(() => setActive(true), 300);
    }, 3000);
    return () => clearInterval(interval);
  }, []);
  return <BoxPrivacy active={active} />;
}

const SLIDES = [
  { tagline: "Pay per thought", render: () => <LiveMeterPill /> },
  { tagline: "Every frontier model", render: () => <LiveModelGrid /> },
  { tagline: "AI debates itself", render: () => <LiveDebateTrace /> },
  { tagline: "Log your decisions", render: () => <LiveDecisionCard /> },
  { tagline: "Private by default", render: () => <LoopingBoxPrivacy /> },
];

export default function SlidesPage() {
  const [current, setCurrent] = useState(0);
  const [fading, setFading] = useState(false);

  function goTo(idx: number) {
    if (idx === current || fading || idx < 0 || idx >= SLIDES.length) return;
    setFading(true);
    setTimeout(() => {
      setCurrent(idx);
      setTimeout(() => setFading(false), 50);
    }, 400);
  }

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "ArrowRight" || e.key === "ArrowDown") goTo(current + 1);
      else if (e.key === "ArrowLeft" || e.key === "ArrowUp") goTo(current - 1);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, fading]);

  const slide = SLIDES[current];

  return (
    <div className="min-h-screen w-full flex flex-col items-center justify-center bg-background relative overflow-hidden">
      <div
        className="flex flex-col items-center justify-center gap-16 transition-opacity duration-400"
        style={{ opacity: fading ? 0 : 1 }}
      >
        <h1 className="text-5xl sm:text-7xl font-semibold tracking-tight text-foreground text-center">
          {slide.tagline}
        </h1>
        <div className="transform scale-150 origin-center">
          {slide.render()}
        </div>
      </div>

      {/* Dot navigation */}
      <div className="fixed bottom-8 left-1/2 -translate-x-1/2 flex gap-2">
        {SLIDES.map((_, i) => (
          <button
            key={i}
            onClick={() => goTo(i)}
            className={`w-2 h-2 rounded-full transition-colors ${
              i === current ? "bg-foreground/60" : "bg-foreground/15"
            }`}
          />
        ))}
      </div>
    </div>
  );
}
