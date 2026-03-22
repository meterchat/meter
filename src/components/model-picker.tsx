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

export function ProviderLogo({ provider, size = 14 }: { provider: string; size?: number }) {
  if (provider === "Anthropic") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path d="M4.709 15.955l4.72-2.647.08-.23-.08-.128H9.2l-.79-.048-2.698-.073-2.339-.097-2.266-.122-.571-.121L0 11.784l.055-.352.48-.321.686.06 1.52.103 2.278.158 1.652.097 2.449.255h.389l.055-.157-.134-.098-.103-.097-2.358-1.596-2.552-1.688-1.336-.972-.724-.491-.364-.462-.158-1.008.656-.722.881.06.225.061.893.686 1.908 1.476 2.491 1.833.365.304.145-.103.019-.073-.164-.274-1.355-2.446-1.446-2.49-.644-1.032-.17-.619a2.97 2.97 0 01-.104-.729L6.283.134 6.696 0l.996.134.42.364.62 1.414 1.002 2.229 1.555 3.03.456.898.243.832.091.255h.158V9.01l.128-1.706.237-2.095.23-2.695.08-.76.376-.91.747-.492.584.28.48.685-.067.444-.286 1.851-.559 2.903-.364 1.942h.212l.243-.242.985-1.306 1.652-2.064.73-.82.85-.904.547-.431h1.033l.76 1.129-.34 1.166-1.064 1.347-.881 1.142-1.264 1.7-.79 1.36.073.11.188-.02 2.856-.606 1.543-.28 1.841-.315.833.388.091.395-.328.807-1.969.486-2.309.462-3.439.813-.042.03.049.061 1.549.146.662.036h1.622l3.02.225.79.522.474.638-.079.485-1.215.62-1.64-.389-3.829-.91-1.312-.329h-.182v.11l1.093 1.068 2.006 1.81 2.509 2.33.127.578-.322.455-.34-.049-2.205-1.657-.851-.747-1.926-1.62h-.128v.17l.444.649 2.345 3.521.122 1.08-.17.353-.608.213-.668-.122-1.374-1.925-1.415-2.167-1.143-1.943-.14.08-.674 7.254-.316.37-.729.28-.607-.461-.322-.747.322-1.476.389-1.924.315-1.53.286-1.9.17-.632-.012-.042-.14.018-1.434 1.967-2.18 2.945-1.726 1.845-.414.164-.717-.37.067-.662.401-.589 2.388-3.036 1.44-1.882.93-1.086-.006-.158h-.055L4.132 18.56l-1.13.146-.487-.456.061-.746.231-.243 1.908-1.312-.006.006z" fill="#D97757" fillRule="nonzero" />
      </svg>
    );
  }
  if (provider === "OpenAI") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path d="M9.205 8.658v-2.26c0-.19.072-.333.238-.428l4.543-2.616c.619-.357 1.356-.523 2.117-.523 2.854 0 4.662 2.212 4.662 4.566 0 .167 0 .357-.024.547l-4.71-2.759a.797.797 0 00-.856 0l-5.97 3.473zm10.609 8.8V12.06c0-.333-.143-.57-.429-.737l-5.97-3.473 1.95-1.118a.433.433 0 01.476 0l4.543 2.617c1.309.76 2.189 2.378 2.189 3.948 0 1.808-1.07 3.473-2.76 4.163zM7.802 12.703l-1.95-1.142c-.167-.095-.239-.238-.239-.428V5.899c0-2.545 1.95-4.472 4.591-4.472 1 0 1.927.333 2.712.928L8.23 5.067c-.285.166-.428.404-.428.737v6.898zM12 15.128l-2.795-1.57v-3.33L12 8.658l2.795 1.57v3.33L12 15.128zm1.796 7.23c-1 0-1.927-.332-2.712-.927l4.686-2.712c.285-.166.428-.404.428-.737v-6.898l1.974 1.142c.167.095.238.238.238.428v5.233c0 2.545-1.974 4.472-4.614 4.472zm-5.637-5.303l-4.544-2.617c-1.308-.761-2.188-2.378-2.188-3.948A4.482 4.482 0 014.21 6.327v5.423c0 .333.143.571.428.738l5.947 3.449-1.95 1.118a.432.432 0 01-.476 0zm-.262 3.9c-2.688 0-4.662-2.021-4.662-4.519 0-.19.024-.38.047-.57l4.686 2.71c.286.167.571.167.856 0l5.97-3.448v2.26c0 .19-.07.333-.237.428l-4.543 2.616c-.619.357-1.356.523-2.117.523zm5.899 2.83a5.947 5.947 0 005.827-4.756C22.287 18.339 24 15.84 24 13.296c0-1.665-.713-3.282-1.998-4.448.119-.5.19-.999.19-1.498 0-3.401-2.759-5.947-5.946-5.947-.642 0-1.26.095-1.88.31A5.962 5.962 0 0010.205 0a5.947 5.947 0 00-5.827 4.757C1.713 5.447 0 7.945 0 10.49c0 1.666.713 3.283 1.998 4.448-.119.5-.19 1-.19 1.499 0 3.401 2.759 5.946 5.946 5.946.642 0 1.26-.095 1.88-.309a5.96 5.96 0 004.162 1.713z" fill="#10A37F" fillRule="evenodd" />
      </svg>
    );
  }
  if (provider === "Google") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="#3186FF" />
        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-g0)" />
        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-g1)" />
        <path d="M20.616 10.835a14.147 14.147 0 01-4.45-3.001 14.111 14.111 0 01-3.678-6.452.503.503 0 00-.975 0 14.134 14.134 0 01-3.679 6.452 14.155 14.155 0 01-4.45 3.001c-.65.28-1.318.505-2.002.678a.502.502 0 000 .975c.684.172 1.35.397 2.002.677a14.147 14.147 0 014.45 3.001 14.112 14.112 0 013.679 6.453.502.502 0 00.975 0c.172-.685.397-1.351.677-2.003a14.145 14.145 0 013.001-4.45 14.113 14.113 0 016.453-3.678.503.503 0 000-.975 13.245 13.245 0 01-2.003-.678z" fill="url(#gemini-g2)" />
        <defs>
          <linearGradient gradientUnits="userSpaceOnUse" id="gemini-g0" x1="7" x2="11" y1="15.5" y2="12"><stop stopColor="#08B962" /><stop offset="1" stopColor="#08B962" stopOpacity="0" /></linearGradient>
          <linearGradient gradientUnits="userSpaceOnUse" id="gemini-g1" x1="8" x2="11.5" y1="5.5" y2="11"><stop stopColor="#F94543" /><stop offset="1" stopColor="#F94543" stopOpacity="0" /></linearGradient>
          <linearGradient gradientUnits="userSpaceOnUse" id="gemini-g2" x1="3.5" x2="17.5" y1="13.5" y2="12"><stop stopColor="#FABC12" /><stop offset=".46" stopColor="#FABC12" stopOpacity="0" /></linearGradient>
        </defs>
      </svg>
    );
  }
  if (provider === "DeepSeek") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" className="shrink-0">
        <path d="M23.748 4.482c-.254-.124-.364.113-.512.234-.051.039-.094.09-.137.136-.372.397-.806.657-1.373.626-.829-.046-1.537.214-2.163.848-.133-.782-.575-1.248-1.247-1.548-.352-.156-.708-.311-.955-.65-.172-.241-.219-.51-.305-.774-.055-.16-.11-.323-.293-.35-.2-.031-.278.136-.356.276-.313.572-.434 1.202-.422 1.84.027 1.436.633 2.58 1.838 3.393.137.093.172.187.129.323-.082.28-.18.552-.266.833-.055.179-.137.217-.329.14a5.526 5.526 0 01-1.736-1.18c-.857-.828-1.631-1.742-2.597-2.458a11.365 11.365 0 00-.689-.471c-.985-.957.13-1.743.388-1.836.27-.098.093-.432-.779-.428-.872.004-1.67.295-2.687.684a3.055 3.055 0 01-.465.137 9.597 9.597 0 00-2.883-.102c-1.885.21-3.39 1.102-4.497 2.623C.082 8.606-.231 10.684.152 12.85c.403 2.284 1.569 4.175 3.36 5.653 1.858 1.533 3.997 2.284 6.438 2.14 1.482-.085 3.133-.284 4.994-1.86.47.234.962.327 1.78.397.63.059 1.236-.03 1.705-.128.735-.156.684-.837.419-.961-2.155-1.004-1.682-.595-2.113-.926 1.096-1.296 2.746-2.642 3.392-7.003.05-.347.007-.565 0-.845-.004-.17.035-.237.23-.256a4.173 4.173 0 001.545-.475c1.396-.763 1.96-2.015 2.093-3.517.02-.23-.004-.467-.247-.588zM11.581 18c-2.089-1.642-3.102-2.183-3.52-2.16-.392.024-.321.471-.235.763.09.288.207.486.371.739.114.167.192.416-.113.603-.673.416-1.842-.14-1.897-.167-1.361-.802-2.5-1.86-3.301-3.307-.774-1.393-1.224-2.887-1.298-4.482-.02-.386.093-.522.477-.592a4.696 4.696 0 011.529-.039c2.132.312 3.946 1.265 5.468 2.774.868.86 1.525 1.887 2.202 2.891.72 1.066 1.494 2.082 2.48 2.914.348.292.625.514.891.677-.802.09-2.14.11-3.054-.614zm1-6.44a.306.306 0 01.415-.287.302.302 0 01.2.288.306.306 0 01-.31.307.303.303 0 01-.304-.308zm3.11 1.596c-.2.081-.399.151-.59.16a1.245 1.245 0 01-.798-.254c-.274-.23-.47-.358-.552-.758a1.73 1.73 0 01.016-.588c.07-.327-.008-.537-.239-.727-.187-.156-.426-.199-.688-.199a.559.559 0 01-.254-.078c-.11-.054-.2-.19-.114-.358.028-.054.16-.186.192-.21.356-.202.767-.136 1.146.016.352.144.618.408 1.001.782.391.451.462.576.685.914.176.265.336.537.445.848.067.195-.019.354-.25.452z" fill="#4D6BFE" />
      </svg>
    );
  }
  if (provider === "xAI") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="#FFFFFF" fillRule="evenodd" className="shrink-0">
        <path d="M9.27 15.29l7.978-5.897c.391-.29.95-.177 1.137.272.98 2.369.542 5.215-1.41 7.169-1.951 1.954-4.667 2.382-7.149 1.406l-2.711 1.257c3.889 2.661 8.611 2.003 11.562-.953 2.341-2.344 3.066-5.539 2.388-8.42l.006.007c-.983-4.232.242-5.924 2.75-9.383.06-.082.12-.164.179-.248l-3.301 3.305v-.01L9.267 15.292M7.623 16.723c-2.792-2.67-2.31-6.801.071-9.184 1.761-1.763 4.647-2.483 7.166-1.425l2.705-1.25a7.808 7.808 0 00-1.829-1A8.975 8.975 0 005.984 5.83c-2.533 2.536-3.33 6.436-1.962 9.764 1.022 2.487-.653 4.246-2.34 6.022-.599.63-1.199 1.259-1.682 1.925l7.62-6.815" />
      </svg>
    );
  }
  // Meter — crosshair SVG
  if (provider === "Meter") {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="shrink-0">
        <path d="M12 3v4" />
        <path d="M12 17v4" />
        <path d="M3 12h4" />
        <path d="M17 12h4" />
        <circle cx="12" cy="12" r="4" fill="currentColor" stroke="none" />
      </svg>
    );
  }
  return <span className="inline-block rounded-full shrink-0" style={{ width: size, height: size, backgroundColor: "#888" }} />;
}

export function ModelLogo({ model, size = 14 }: { model: ModelConfig; size?: number }) {
  // Meter uses currentColor — apply tint
  if (model.provider === "Meter") {
    return (
      <span style={{ color: model.color }}>
        <ProviderLogo provider={model.provider} size={size} />
      </span>
    );
  }
  // All other providers have brand colors baked into their SVGs
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
  const enabledModels = useMeterStore((s) => s.enabledModels);
  const markupMultiplier = useMeterStore((s) => s.markupMultiplier);

  // Filter models by admin config (empty = all enabled, always keep "auto")
  const visibleModels = enabledModels.length === 0
    ? MODELS
    : MODELS.filter((m) => m.id === "auto" || enabledModels.includes(m.id));

  return (
    <div className="p-1.5">
      <div className="space-y-0.5">
        {visibleModels.map((m) => {
          const isAuto = m.id === "auto";
          const isSelected = m.id === selectedModelId;
          const isInRoster = debateRoster.includes(m.id);

          return (
            <div
              key={m.id}
              className={`flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left transition-colors hover:bg-foreground/[0.08] ${
                (!debateMode && isSelected) || (debateMode && isInRoster) ? "bg-foreground/[0.07]" : ""
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
                    <span className="text-muted-foreground/50">{fmtPrice(m.inputPrice * markupMultiplier)}/{fmtPrice(m.outputPrice * markupMultiplier)} per 1M</span>
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
                    const currentRoster = useMeterStore.getState().debateRoster;

                    // Removing a model from the roster
                    if (currentRoster.includes(m.id)) {
                      const next = currentRoster.filter((id) => id !== m.id);
                      setDebateRoster(next);
                      if (next.length === 1) setSelectedModelId(next[0]);
                      return;
                    }

                    // Adding a model — also auto-include current primary
                    let next = [...currentRoster, m.id];
                    if (selectedModelId !== "auto" && !next.includes(selectedModelId)) {
                      next = [selectedModelId, ...next];
                    }
                    setDebateRoster(next);
                  }}
                  className="flex h-8 w-8 shrink-0 items-center justify-center"
                  title={isInRoster ? "Remove from debate" : "Add to debate"}
                >
                  <span className={`flex h-3.5 w-3.5 items-center justify-center rounded border transition-colors ${
                    isInRoster || (!debateMode && isSelected)
                      ? "border-foreground/60 bg-foreground/10"
                      : "border-foreground/20 hover:border-foreground/40"
                  }`}>
                    {(isInRoster || (!debateMode && isSelected)) && (
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
