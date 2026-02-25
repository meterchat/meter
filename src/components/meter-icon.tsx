"use client";

import { useState, useEffect, useRef } from "react";

const FRAMES = [
  "/frame-1.png",
  "/frame-2.png",
  "/frame-3.png",
  "/frame-4.png",
  "/frame-5.png",
  "/frame-6.png",
];

// Preload all frames immediately on module load
if (typeof window !== "undefined") {
  FRAMES.forEach((src) => {
    const img = new window.Image();
    img.src = src;
  });
}

interface MeterIconProps {
  active: boolean;
  size?: number;
}

export function MeterIcon({ size = 20 }: MeterIconProps) {
  const [frame, setFrame] = useState(0);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const imagesRef = useRef<HTMLImageElement[]>([]);

  // Load images into refs on mount
  useEffect(() => {
    imagesRef.current = FRAMES.map((src) => {
      const img = new window.Image();
      img.src = src;
      return img;
    });
  }, []);

  // Always animate — meter icon spins continuously
  useEffect(() => {
    const interval = setInterval(() => {
      setFrame((f) => (f + 1) % FRAMES.length);
    }, 100);
    return () => clearInterval(interval);
  }, []);

  // Draw to canvas for instant rendering
  useEffect(() => {
    const canvas = canvasRef.current;
    const img = imagesRef.current[frame];
    if (!canvas || !img) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    if (img.complete) {
      ctx.clearRect(0, 0, size, size);
      ctx.drawImage(img, 0, 0, size, size);
    } else {
      img.onload = () => {
        ctx.clearRect(0, 0, size, size);
        ctx.drawImage(img, 0, 0, size, size);
      };
    }
  }, [frame, size]);

  return (
    <canvas
      ref={canvasRef}
      width={size}
      height={size}
      style={{ width: size, height: size, imageRendering: "pixelated" }}
    />
  );
}
