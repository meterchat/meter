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
  {
    tagline: "Pay per thought",
    subtitle: "Real-time cost tracking for every AI call",
    render: () => <LiveMeterPill />,
    scale: 1.8,
  },
  {
    tagline: "Every frontier model",
    subtitle: "One API, all the best models",
    render: () => <LiveModelGrid />,
    scale: 1.6,
  },
  {
    tagline: "AI debates itself",
    subtitle: "Multi-model debates surface better answers",
    render: () => <LiveDebateTrace />,
    scale: 1.5,
  },
  {
    tagline: "Log your decisions",
    subtitle: "Structured records, not chat transcripts",
    render: () => <LiveDecisionCard />,
    scale: 1.5,
  },
  {
    tagline: "Private by default",
    subtitle: "Passkey auth, no passwords stored",
    render: () => <LoopingBoxPrivacy />,
    scale: 2.0,
  },
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
    <div className="h-screen w-full flex bg-background relative overflow-hidden">
      <div
        className="flex-1 flex transition-opacity duration-400"
        style={{ opacity: fading ? 0 : 1 }}
      >
        {/* Left half — text */}
        <div className="w-1/2 flex flex-col justify-center pl-[8vw] pr-8">
          <h1 className="text-5xl sm:text-6xl lg:text-7xl font-semibold tracking-tight text-foreground leading-[1.1]">
            {slide.tagline}
          </h1>
          {slide.subtitle && (
            <p className="mt-4 text-lg sm:text-xl text-muted-foreground/60 max-w-md leading-relaxed">
              {slide.subtitle}
            </p>
          )}
        </div>

        {/* Right half — animation */}
        <div className="w-1/2 flex items-center justify-center">
          <div
            className="origin-center"
            style={{ transform: `scale(${slide.scale})` }}
          >
            {slide.render()}
          </div>
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
