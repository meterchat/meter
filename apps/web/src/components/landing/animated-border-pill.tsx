"use client";

import { ReactNode, useRef, useEffect, useState } from "react";
import { cn } from "@/lib/utils";

interface AnimatedBorderPillProps {
  children: ReactNode;
  className?: string;
}

export function AnimatedBorderPill({ children, className }: AnimatedBorderPillProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [perimeter, setPerimeter] = useState(250);
  const [borderRadius, setBorderRadius] = useState(16);

  useEffect(() => {
    if (containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect();
      const radius = rect.height / 2;
      setBorderRadius(radius);
      const straightPart = 2 * (rect.width - rect.height);
      const roundedPart = Math.PI * rect.height;
      setPerimeter(Math.round(straightPart + roundedPart));
    }
  }, []);

  const dashLength = 40;
  const gapLength = perimeter - dashLength;

  return (
    <div
      ref={containerRef}
      className={cn(
        "relative inline-flex items-center gap-2 px-4 py-2 text-xs font-medium whitespace-nowrap",
        className
      )}
    >
      <style>
        {`
          @keyframes border-travel-${perimeter} {
            from { stroke-dashoffset: 0; }
            to { stroke-dashoffset: -${perimeter}; }
          }
        `}
      </style>
      <svg className="absolute inset-0 w-full h-full pointer-events-none" preserveAspectRatio="none">
        <rect
          x="0.5" y="0.5"
          width="calc(100% - 1px)" height="calc(100% - 1px)"
          rx={borderRadius} ry={borderRadius}
          fill="none" stroke="hsl(var(--border))" strokeWidth="1"
        />
        <rect
          x="0.5" y="0.5"
          width="calc(100% - 1px)" height="calc(100% - 1px)"
          rx={borderRadius} ry={borderRadius}
          fill="none" stroke="hsl(var(--primary))" strokeWidth="1"
          strokeDasharray={`${dashLength} ${gapLength}`}
          style={{ animation: `border-travel-${perimeter} 4s linear infinite` }}
        />
      </svg>
      <span className="relative z-10 inline-flex items-center gap-2">{children}</span>
    </div>
  );
}
