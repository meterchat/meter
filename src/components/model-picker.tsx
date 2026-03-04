"use client";

import { useMeterStore } from "@/lib/store";
import { trackModelSelected } from "@/lib/analytics";
import { MODELS, getModel, shortModelName, ModelConfig } from "@/lib/models";

/** Format a per-token price as a human-readable $/M string */
function fmtPrice(pricePerToken: number): string {
  const perM = pricePerToken * 1_000_000;
  if (perM < 1) return `$${perM.toFixed(2)}`;
  if (perM % 1 === 0) return `$${perM}`;
  return `$${perM.toFixed(2)}`;
}

/** Fastest model speed across all models — used to compute relative speed bars */
const MAX_SPEED = Math.max(...MODELS.map((m) => m.speed ?? 0));

/** Tiny inline speed bar — width proportional to model speed vs fastest */
function SpeedBar({ speed }: { speed: number }) {
  const pct = Math.round((speed / MAX_SPEED) * 100);
  return (
    <span className="inline-flex items-center gap-1">
      <span className="inline-block h-[3px] rounded-full bg-foreground/20" style={{ width: 32 }}>
        <span
          className="block h-full rounded-full bg-foreground/50"
          style={{ width: `${pct}%` }}
        />
      </span>
      <span className="text-muted-foreground/50">{speed} t/s</span>
    </span>
  );
}

function ProviderLogo({ provider, size = 14 }: { provider: string; size?: number }) {
  switch (provider) {
    case "Anthropic":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M13.827 3.52l5.99 16.96h-3.354l-1.27-3.727H9.78l1.27 3.727H7.696L13.827 3.52zm-.353 4.613L11.07 14.48h4.809l-2.405-6.347z" />
        </svg>
      );
    case "OpenAI":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M22.282 9.821a5.985 5.985 0 0 0-.516-4.91 6.046 6.046 0 0 0-6.51-2.9A6.065 6.065 0 0 0 4.981 4.18a5.998 5.998 0 0 0-3.998 2.9 6.042 6.042 0 0 0 .743 7.097 5.98 5.98 0 0 0 .51 4.911 6.051 6.051 0 0 0 6.515 2.9A5.985 5.985 0 0 0 13.26 24a6.056 6.056 0 0 0 5.772-4.206 5.99 5.99 0 0 0 3.997-2.9 6.056 6.056 0 0 0-.747-7.073zM13.26 22.43a4.476 4.476 0 0 1-2.876-1.04l.141-.081 4.779-2.758a.795.795 0 0 0 .392-.681v-6.737l2.02 1.168a.071.071 0 0 1 .038.052v5.583a4.504 4.504 0 0 1-4.494 4.494zM3.6 18.304a4.47 4.47 0 0 1-.535-3.014l.142.085 4.783 2.759a.771.771 0 0 0 .78 0l5.843-3.369v2.332a.08.08 0 0 1-.033.062L9.74 19.95a4.5 4.5 0 0 1-6.14-1.646zM2.34 7.896a4.485 4.485 0 0 1 2.366-1.973V11.6a.766.766 0 0 0 .388.676l5.815 3.355-2.02 1.168a.076.076 0 0 1-.071 0l-4.83-2.786A4.504 4.504 0 0 1 2.34 7.872zm16.597 3.855l-5.833-3.387L15.119 7.2a.076.076 0 0 1 .071 0l4.83 2.791a4.494 4.494 0 0 1-.676 8.105v-5.678a.79.79 0 0 0-.407-.667zm2.01-3.023l-.141-.085-4.774-2.782a.776.776 0 0 0-.785 0L9.409 9.23V6.897a.066.066 0 0 1 .028-.061l4.83-2.787a4.5 4.5 0 0 1 6.68 4.66zm-12.64 4.135l-2.02-1.164a.08.08 0 0 1-.038-.057V6.075a4.5 4.5 0 0 1 7.375-3.453l-.142.08L8.704 5.46a.795.795 0 0 0-.393.681zm1.097-2.365l2.602-1.5 2.607 1.5v2.999l-2.597 1.5-2.607-1.5z" />
        </svg>
      );
    case "Google":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M12 0C12 6.627 6.627 12 0 12c6.627 0 12 5.373 12 12 0-6.627 5.373-12 12-12-6.627 0-12-5.373-12-12z" />
        </svg>
      );
    case "DeepSeek":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm-1 14.5c-2.49 0-4.5-2.01-4.5-4.5S8.51 7.5 11 7.5c1.25 0 2.38.51 3.19 1.33l-1.29 1.25A2.99 2.99 0 0 0 11 9.5c-1.38 0-2.5 1.12-2.5 2.5s1.12 2.5 2.5 2.5c1.19 0 2.19-.83 2.44-1.95H11v-1.55h4.44c.05.28.06.56.06.85 0 2.49-2.01 4.15-4.5 4.15z" />
        </svg>
      );
    case "xAI":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" className="shrink-0">
          <path d="M2.3 4h4.3l5.4 8.1L17.4 4h4.3l-7.7 11.3L21.7 20h-4.3l-5.4-8.1L6.6 20H2.3l7.7-11.3L2.3 4z" />
        </svg>
      );
    case "Meter":
      return (
        <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
          <path d="M12 3v4" />
          <path d="M12 17v4" />
          <path d="M3 12h4" />
          <path d="M17 12h4" />
          <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
        </svg>
      );
    default:
      return <span className="h-3 w-3 rounded-full shrink-0" style={{ backgroundColor: "#888" }} />;
  }
}

export function ModelLogo({ model, size = 14 }: { model: ModelConfig; size?: number }) {
  return (
    <span style={{ color: model.color }}>
      <ProviderLogo provider={model.provider} size={size} />
    </span>
  );
}

/* ─── Model Selector Bar (full-width top bar) ─── */
export function ModelSelectorBar({
  open,
  onToggle,
  overrideModelId,
}: {
  open: boolean;
  onToggle: () => void;
  overrideModelId?: string | null;
}) {
  const selectedModelId = useMeterStore((s) => s.selectedModelId);
  const debateMode = useMeterStore((s) => s.debateMode);
  const debateRoster = useMeterStore((s) => s.debateRoster);
  const isStreaming = useMeterStore((s) => {
    const project = s.projects.find((p) => p.id === s.activeProjectId) ?? s.projects[0];
    return project?.isStreaming ?? false;
  });
  const displayId = overrideModelId ?? selectedModelId;
  const model = getModel(displayId);

  return (
    <button
      onClick={onToggle}
      disabled={isStreaming}
      className="flex w-full items-center gap-2 bg-foreground/[0.03] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground/80 hover:bg-foreground/5 disabled:opacity-40"
    >
      {debateMode ? (
        <>
          {/* Show all debate roster models */}
          <span className="inline-flex items-center gap-1.5">
            {debateRoster.map((id) => {
              const dm = getModel(id);
              return (
                <span key={id} className="inline-flex items-center gap-1" style={{ color: dm.color }}>
                  <ProviderLogo provider={dm.provider} size={11} />
                  <span className="text-[11px] text-foreground normal-case tracking-normal">{shortModelName(id)}</span>
                </span>
              );
            })}
          </span>
          <span className="text-muted-foreground/50 text-[10px] normal-case tracking-normal">(Debate)</span>
        </>
      ) : (
        <>
          <ModelLogo model={model} size={12} />
          <span className="text-[12px] text-foreground normal-case tracking-normal truncate">
            {model.name}
          </span>
          <span className="text-[10px] text-muted-foreground/50 normal-case tracking-normal">
            {model.provider}
          </span>
        </>
      )}
      <svg
        width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor"
        strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        className={`ml-auto transition-transform duration-200 ${open ? "rotate-180" : ""}`}
      >
        <polyline points="6 9 12 15 18 9" />
      </svg>
    </button>
  );
}

/** @deprecated Use ModelSelectorBar */
export const ModelPickerTrigger = ModelSelectorBar;

/* ─── Panel (rendered inline above the input row) ─── */
export function ModelPickerPanel({
  onClose,
}: {
  onClose: () => void;
}) {
  const selectedModelId = useMeterStore((s) => s.selectedModelId);
  const setSelectedModelId = useMeterStore((s) => s.setSelectedModelId);
  const debateRoster = useMeterStore((s) => s.debateRoster);
  const toggleDebateRosterModel = useMeterStore((s) => s.toggleDebateRosterModel);

  return (
    <div className="p-1.5">
      <div className="space-y-0.5">
        {MODELS.map((m) => {
          const isAuto = m.id === "auto";
          const isSelected = m.id === selectedModelId;
          const isInRoster = debateRoster.includes(m.id);

          return (
            <div
              key={m.id}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.08] ${
                isSelected ? "bg-foreground/[0.07]" : ""
              }`}
            >
              {/* Click model name to select as primary */}
              <button
                className="flex flex-1 items-start gap-2.5 min-w-0 text-left"
                onClick={() => {
                  trackModelSelected({ model: m.id, previousModel: selectedModelId });
                  setSelectedModelId(m.id);
                  onClose();
                }}
              >
                <ModelLogo model={m} size={16} />
                <div className="min-w-0">
                  <div className="text-xs font-medium text-foreground truncate">
                    {m.name}
                  </div>
                  <div className="text-[10px] text-muted-foreground font-mono flex items-center gap-1.5 flex-wrap">
                    <span>{m.provider}</span>
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span className="text-muted-foreground/50">{fmtPrice(m.inputPrice)}/{fmtPrice(m.outputPrice)} per 1M</span>
                    {m.quality != null && (
                      <>
                        <span className="text-muted-foreground/40">&middot;</span>
                        <span>{m.quality}% GPQA</span>
                      </>
                    )}
                    {m.speed != null && (
                      <>
                        <span className="text-muted-foreground/40">&middot;</span>
                        <SpeedBar speed={m.speed} />
                      </>
                    )}
                  </div>
                </div>
              </button>
              {/* Right side: checkbox (debate roster) for non-Auto, or selected tick for Auto */}
              {!isAuto ? (
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    toggleDebateRosterModel(m.id);
                  }}
                  className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border transition-colors ${
                    isInRoster
                      ? "border-foreground/60 bg-foreground/10"
                      : isSelected
                        ? "border-foreground/40 bg-transparent"
                        : "border-foreground/20 hover:border-foreground/40"
                  }`}
                  title={isInRoster ? "Remove from debate" : "Add to debate"}
                >
                  {(isInRoster || isSelected) && (
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
                      <polyline points="20 6 9 17 4 12" />
                    </svg>
                  )}
                </button>
              ) : isSelected ? (
                <svg
                  width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                  strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                  className="text-foreground shrink-0"
                >
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
