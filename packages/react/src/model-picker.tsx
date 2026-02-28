import React, { useState, useRef, useEffect } from "react";
import type { MeterModel } from "./types";

interface ModelPickerProps {
  models: MeterModel[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  className?: string;
}

export function ModelPicker({
  models,
  selectedModelId,
  onSelect,
  className,
}: ModelPickerProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const selected = models.find((m) => m.id === selectedModelId) ?? models[0];

  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  return (
    <div ref={ref} className={className} style={{ position: "relative", display: "inline-block" }}>
      <button
        onClick={() => setOpen(!open)}
        style={{
          background: "none",
          border: "1px solid var(--meter-border, #333)",
          borderRadius: "6px",
          padding: "4px 10px",
          fontSize: "12px",
          color: "var(--meter-text-primary, #fff)",
          cursor: "pointer",
          fontFamily: "inherit",
        }}
      >
        {selected.name} ▾
      </button>

      {open && (
        <div
          style={{
            position: "absolute",
            bottom: "100%",
            left: 0,
            marginBottom: "4px",
            background: "var(--meter-bg-elevated, #1a1a1a)",
            border: "1px solid var(--meter-border, #333)",
            borderRadius: "8px",
            padding: "4px",
            minWidth: "200px",
            zIndex: 50,
          }}
        >
          {models.map((m) => (
            <button
              key={m.id}
              onClick={() => {
                onSelect(m.id);
                setOpen(false);
              }}
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                width: "100%",
                padding: "6px 8px",
                border: "none",
                borderRadius: "4px",
                background: m.id === selectedModelId ? "var(--meter-bg-active, #333)" : "transparent",
                color: "var(--meter-text-primary, #fff)",
                cursor: "pointer",
                fontSize: "12px",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span>{m.name}</span>
              <span style={{ color: "var(--meter-text-secondary, #888)", fontFamily: "monospace", fontSize: "11px" }}>
                {m.provider}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
