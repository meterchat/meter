import React, { useState, useRef, useEffect } from "react";
import type { MeterModel } from "./types";

/* ─── Provider logos (inline SVGs, same as main app) ─── */

function ProviderLogo({ provider, size = 14 }: { provider: string; size?: number }) {
  switch (provider) {
    case "Anthropic":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M13.827 3.52l5.99 16.96h-3.354l-1.27-3.727H9.78l1.27 3.727H7.696L13.827 3.52zm-.353 4.613L11.07 14.48h4.809l-2.405-6.347z" />
        </svg>
      );
    case "OpenAI":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      );
    case "Google":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
        </svg>
      );
    case "DeepSeek":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5c-2.49 0-4.5-2.01-4.5-4.5S8.51 7.5 11 7.5c1.25 0 2.38.51 3.19 1.33l-1.29 1.25A2.99 2.99 0 0 0 11 9.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5c1.19 0 2.19-.83 2.44-1.95H11v-1.55h4.44c.05.28.06.56.06.85 0 2.49-2.01 4.15-4.5 4.15z" />
        </svg>
      );
    case "xAI":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ flexShrink: 0 }}>
          <path d="M2.3 4h4.3l5.4 8.1L17.4 4h4.3l-7.7 11.3L21.7 20h-4.3l-5.4-8.1L6.6 20H2.3l7.7-11.3L2.3 4z" />
        </svg>
      );
    case "Meter":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ flexShrink: 0 }}>
          <path d="M12 3v4" />
          <path d="M12 17v4" />
          <path d="M3 12h4" />
          <path d="M17 12h4" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", backgroundColor: "#888", flexShrink: 0 }} />;
  }
}

/* ─── Provider color map ─── */

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "#D97757",
  OpenAI: "#10A37F",
  Google: "#4285F4",
  DeepSeek: "#4D6BFE",
  xAI: "#A0A0A0",
  Meter: "#A1A1AA",
};

function getProviderColor(provider: string): string {
  return PROVIDER_COLORS[provider] ?? "#888";
}

/* ─── Model Selector Bar (replaces connections bar) ─── */

interface ModelSelectorBarProps {
  models: MeterModel[];
  selectedModelId: string;
  onSelect: (modelId: string) => void;
  className?: string;
}

export function ModelSelectorBar({
  models,
  selectedModelId,
  onSelect,
  className,
}: ModelSelectorBarProps) {
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
    <div ref={ref} className={className} style={{ position: "relative" }}>
      {/* Bar trigger — full-width, shows logo + model name */}
      <button
        onClick={() => setOpen(!open)}
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          width: "100%",
          background: "var(--meter-bg-elevated, rgba(255,255,255,0.03))",
          border: "none",
          padding: "8px 12px",
          fontSize: "11px",
          fontFamily: "var(--meter-font-mono, ui-monospace, monospace)",
          color: "var(--meter-text-secondary, #888)",
          cursor: "pointer",
          textTransform: "uppercase",
          letterSpacing: "0.05em",
        }}
      >
        <span style={{ color: getProviderColor(selected.provider), display: "flex", alignItems: "center" }}>
          <ProviderLogo provider={selected.provider} size={12} />
        </span>
        <span style={{ color: "var(--meter-text-primary, #e5e5e5)", textTransform: "none", letterSpacing: "normal", fontSize: "12px" }}>
          {selected.name}
        </span>
        <span style={{ fontSize: "10px", color: "var(--meter-text-secondary, #555)" }}>
          {selected.provider}
        </span>
        <svg
          width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor"
          strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
          style={{
            marginLeft: "auto",
            transition: "transform 0.2s",
            transform: open ? "rotate(180deg)" : "rotate(0deg)",
          }}
        >
          <polyline points="6 9 12 15 18 9" />
        </svg>
      </button>

      {/* Drawer panel — opens upward from the bar */}
      {open && (
        <div
          style={{
            borderTop: "1px solid var(--meter-border, #262626)",
            background: "var(--meter-bg-elevated, rgba(255,255,255,0.03))",
            padding: "4px",
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
                alignItems: "center",
                gap: "8px",
                width: "100%",
                padding: "8px",
                border: "none",
                borderRadius: "6px",
                background: m.id === selectedModelId ? "var(--meter-bg-active, rgba(255,255,255,0.07))" : "transparent",
                color: "var(--meter-text-primary, #fff)",
                cursor: "pointer",
                fontSize: "12px",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <span style={{ color: getProviderColor(m.provider), display: "flex", alignItems: "center" }}>
                <ProviderLogo provider={m.provider} size={14} />
              </span>
              <span style={{ flex: 1 }}>
                <span style={{ fontWeight: 500 }}>{m.name}</span>
                <span style={{ marginLeft: "6px", color: "var(--meter-text-secondary, #888)", fontFamily: "monospace", fontSize: "10px" }}>
                  {m.provider}
                </span>
              </span>
              {m.id === selectedModelId && (
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  style={{ flexShrink: 0 }}
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/** @deprecated Use ModelSelectorBar instead */
export const ModelPicker = ModelSelectorBar;
