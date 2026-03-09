import React, { useState, useRef, useEffect } from "react";
import type { MeterModel } from "./types";

/** Cost badge: $ (cheapest) to $$$$ (most expensive) */
function costBadge(m: MeterModel): string {
  const perThought = 2000 * m.inputPrice + 1000 * m.outputPrice;
  if (perThought < 0.005) return "$";
  if (perThought < 0.03) return "$$";
  if (perThought < 0.10) return "$$$";
  return "$$$$";
}

function badgeColor(badge: string): string {
  if (badge.length >= 4) return "#fb923c";
  if (badge.length >= 3) return "#facc15a0";
  return "#34d399a0";
}

/** Format a per-token price as a human-readable $/M string */
function fmtPrice(pricePerToken: number): string {
  const perM = pricePerToken * 1_000_000;
  if (perM < 1) return `$${perM.toFixed(2)}`;
  if (perM % 1 === 0) return `$${perM}`;
  return `$${perM.toFixed(2)}`;
}

/* ─── Provider logos (using public image assets) ─── */

const PROVIDER_LOGO: Record<string, string> = {
  Anthropic: "/claude.webp",
  OpenAI: "/openai.webp",
  Google: "/gemini.webp",
  DeepSeek: "/deepseek.webp",
  xAI: "/grok.webp",
  MiniMax: "/minimax.webp",
  Meter: "/icon-transparent.png",
};

function ProviderLogo({ provider, size = 14 }: { provider: string; size?: number }) {
  const src = PROVIDER_LOGO[provider];
  if (!src) return <span style={{ display: "inline-block", width: size, height: size, borderRadius: "50%", backgroundColor: "#888", flexShrink: 0 }} />;
  return (
    <img
      src={src}
      alt={provider}
      width={size}
      height={size}
      draggable={false}
      style={{ flexShrink: 0, borderRadius: 2, objectFit: "contain" }}
    />
  );
}

/* ─── Provider color map ─── */

const PROVIDER_COLORS: Record<string, string> = {
  Anthropic: "#D97757",
  OpenAI: "#10A37F",
  Google: "#4285F4",
  DeepSeek: "#4D6BFE",
  xAI: "#A0A0A0",
  MiniMax: "#1A1A2E",
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
                <span style={{ marginLeft: "6px", color: "var(--meter-text-secondary, #666)", fontFamily: "monospace", fontSize: "10px" }}>
                  {fmtPrice(m.inputPrice)}/{fmtPrice(m.outputPrice)} per 1M
                </span>
                <span style={{ marginLeft: "6px", color: badgeColor(costBadge(m)), fontFamily: "monospace", fontSize: "10px" }}>
                  {costBadge(m)}
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
