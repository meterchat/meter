"use client";

import { useEffect, useState, useRef, memo } from "react";
import { useInView } from "framer-motion";
import { cn } from "@/lib/utils";

const SCRAMBLE_CHARS = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789!@#$%^&*";

interface ScrollScrambleTextProps {
  text: string;
  className?: string;
  as?: "span" | "p" | "h1" | "h2" | "h3" | "div";
}

export const ScrollScrambleText = memo(function ScrollScrambleText({
  text,
  className,
  as: Component = "span",
}: ScrollScrambleTextProps) {
  const ref = useRef<HTMLElement>(null);
  const isInView = useInView(ref, { once: true, amount: 0.3 });
  const [displayText, setDisplayText] = useState(text);
  const hasAnimated = useRef(false);

  useEffect(() => {
    if (!isInView || hasAnimated.current) return;
    hasAnimated.current = true;

    const duration = 800;
    const startTime = performance.now();
    const updateInterval = 16;
    let lastUpdate = 0;
    let animationFrame: number;

    const animate = (currentTime: number) => {
      const elapsed = currentTime - startTime;
      const progress = Math.min(elapsed / duration, 1);

      if (currentTime - lastUpdate >= updateInterval) {
        lastUpdate = currentTime;

        if (progress >= 1) {
          setDisplayText(text);
          return;
        }

        const result = text
          .split("")
          .map((char, index) => {
            if (char === " ") return " ";
            const charThreshold = index / text.length;
            if (progress > charThreshold + 0.1) {
              return char;
            } else if (progress > charThreshold - 0.1) {
              return Math.random() > 0.3
                ? SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
                : char;
            } else {
              return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
            }
          })
          .join("");

        setDisplayText(result);
      }

      animationFrame = requestAnimationFrame(animate);
    };

    animationFrame = requestAnimationFrame(animate);

    return () => {
      if (animationFrame) cancelAnimationFrame(animationFrame);
    };
  }, [isInView, text]);

  return (
    <Component ref={ref as any} className={cn("relative inline-block", className)}>
      <span className="invisible">{text}</span>
      <span className="absolute inset-0">{displayText}</span>
    </Component>
  );
});

interface ScrambleButtonTextProps {
  text: string;
  duration?: number;
  scrambleOnChange?: boolean;
  className?: string;
  skipInitialAnimation?: boolean;
}

export const ScrambleButtonText = memo(function ScrambleButtonText({
  text,
  duration = 0.4,
  scrambleOnChange = true,
  className,
  skipInitialAnimation = false,
}: ScrambleButtonTextProps) {
  const [displayText, setDisplayText] = useState(text);
  const previousText = useRef(text);
  const animationRef = useRef<number | null>(null);
  const hasAnimated = useRef(skipInitialAnimation);

  useEffect(() => {
    const textChanged = previousText.current !== text;
    const shouldAnimate = !hasAnimated.current || (scrambleOnChange && textChanged);

    if (!shouldAnimate) {
      setDisplayText(text);
      return;
    }

    previousText.current = text;
    hasAnimated.current = true;

    const startTime = performance.now();
    const endTime = startTime + duration * 1000;

    const animate = (currentTime: number) => {
      if (currentTime >= endTime) {
        setDisplayText(text);
        return;
      }

      const progress = (currentTime - startTime) / (duration * 1000);

      const result = text
        .split("")
        .map((char, index) => {
          if (char === " ") return " ";
          const charThreshold = index / text.length;
          if (progress > charThreshold + 0.1) return char;
          if (progress > charThreshold - 0.1) {
            return Math.random() > 0.3
              ? SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)]
              : char;
          }
          return SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
        })
        .join("");

      setDisplayText(result);
      animationRef.current = requestAnimationFrame(animate);
    };

    animationRef.current = requestAnimationFrame(animate);

    return () => {
      if (animationRef.current) cancelAnimationFrame(animationRef.current);
    };
  }, [text, duration, scrambleOnChange]);

  return <span className={className}>{displayText}</span>;
});
