"use client";

import { useMeterStore } from "@/lib/store";
import { trackModelSelected } from "@/lib/analytics";
import { MODELS, getModel, shortModelName, ModelConfig, costBadge } from "@/lib/models";

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

/** Map provider name → public logo image path */
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
  if (!src) return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, backgroundColor: "#888" }} />;
  return (
    <img
      src={src}
      alt={provider}
      width={size}
      height={size}
      className="shrink-0 rounded-sm object-contain"
      draggable={false}
    />
  );
}

export function ModelLogo({ model, size = 14 }: { model: ModelConfig; size?: number }) {
  return <ProviderLogo provider={model.provider} size={size} />;
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
    const project = s.sessions.find((p) => p.id === s.activeSessionId) ?? s.sessions[0];
    return project?.isStreaming ?? false;
  });
  const displayId = overrideModelId ?? selectedModelId;
  const model = getModel(displayId);

  return (
    <button
      onClick={onToggle}
      disabled={isStreaming}
      className="flex w-full items-center gap-2 px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-muted-foreground/60 transition-colors hover:text-muted-foreground/80 hover:bg-foreground/5 disabled:opacity-40"
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
  const debateMode = useMeterStore((s) => s.debateMode);
  const setDebateMode = useMeterStore((s) => s.setDebateMode);
  const setDebateRoster = useMeterStore((s) => s.setDebateRoster);
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
                  if (debateMode) {
                    setDebateMode(false);
                    setDebateRoster([]);
                  }
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
                    <span className="text-muted-foreground/40">&middot;</span>
                    <span className={costBadge(m).length >= 4 ? "text-orange-400" : costBadge(m).length >= 3 ? "text-yellow-400/70" : "text-emerald-400/70"}>{costBadge(m)}</span>
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
                    // If adding a model and the current primary isn't in the roster yet, add it too
                    const currentRoster = useMeterStore.getState().debateRoster;
                    if (!currentRoster.includes(m.id) && !currentRoster.includes(selectedModelId) && selectedModelId !== "auto") {
                      toggleDebateRosterModel(selectedModelId);
                    }
                    toggleDebateRosterModel(m.id);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center"
                  title={isInRoster ? "Remove from debate" : "Add to debate"}
                >
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${
                    isInRoster || isSelected
                      ? "border-foreground/60 bg-foreground/10"
                      : "border-foreground/20 hover:border-foreground/40"
                  }`}>
                    {(isInRoster || isSelected) && (
                      <svg width="9" height="9" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" className="text-foreground">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                    )}
                  </span>
                </button>
              ) : isSelected ? (
                <span className="flex h-8 w-8 shrink-0 items-center justify-center">
                  <svg
                    width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor"
                    strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
                    className="text-foreground"
                  >
                    <polyline points="20 6 9 17 4 12" />
                  </svg>
                </span>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
