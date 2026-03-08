export interface ModelConfig {
  id: string;
  name: string;
  provider: string;
  color: string;
  inputPrice: number;  // per token (user-facing, includes markup)
  outputPrice: number; // per token (user-facing, includes markup)
  /** GPQA Diamond accuracy — graduate-level science benchmark (0-100%) */
  quality?: number;
  /** Output speed in tokens/sec from native API */
  speed?: number;
}

/**
 * Cost badge: $ (cheapest) to $$$$ (most expensive).
 * Based on estimated cost per thought (~2K input + ~1K output tokens).
 */
export function costBadge(m: ModelConfig): string {
  const perThought = 2000 * m.inputPrice + 1000 * m.outputPrice;
  if (perThought < 0.005) return "$";
  if (perThought < 0.03) return "$$";
  if (perThought < 0.10) return "$$$";
  return "$$$$";
}

/** Default debate roster when user toggles debate mode without selecting models */
export const DEFAULT_DEBATE_MODELS = [
  "anthropic/claude-opus-4.6",
  "openai/gpt-5.4",
  "x-ai/grok-4.1-fast",
] as const;

/** Underlying Opus model used by meta-models (Dissector, etc.) */
export const META_MODEL = "anthropic/claude-opus-4.6";

export const MODELS: ModelConfig[] = [
  {
    id: "auto",
    name: "Auto",
    provider: "Meter",
    color: "#E4E4E7",
    inputPrice: (2.50 / 1_000_000),
    outputPrice: (15.0 / 1_000_000),
    quality: 92,  // GPQA Diamond — routes to GPT-5.4
    speed: 90,
  },
  {
    id: "anthropic/claude-sonnet-4.6",
    name: "Sonnet 4.6",
    provider: "Anthropic",
    color: "#D97757",
    inputPrice: (3.0 / 1_000_000),
    outputPrice: (15.0 / 1_000_000),
    quality: 74,  // GPQA Diamond
    speed: 60,
  },
  {
    id: "anthropic/claude-opus-4.6",
    name: "Opus 4.6",
    provider: "Anthropic",
    color: "#D97757",
    inputPrice: (5.0 / 1_000_000),
    outputPrice: (25.0 / 1_000_000),
    quality: 91,  // GPQA Diamond
    speed: 70,
  },
  {
    id: "openai/gpt-5.4",
    name: "GPT-5.4",
    provider: "OpenAI",
    color: "#10A37F",
    inputPrice: (2.50 / 1_000_000),
    outputPrice: (15.0 / 1_000_000),
    quality: 92,  // GPQA Diamond
    speed: 90,
  },
  {
    id: "openai/gpt-5.4-pro",
    name: "GPT-5.4 Pro",
    provider: "OpenAI",
    color: "#10A37F",
    inputPrice: (30.0 / 1_000_000),
    outputPrice: (180.0 / 1_000_000),
    quality: 95,  // GPQA Diamond
    speed: 60,
  },
  {
    id: "google/gemini-3.1-pro-preview",
    name: "Gemini 3.1 Pro",
    provider: "Google",
    color: "#4285F4",
    inputPrice: (2.0 / 1_000_000),
    outputPrice: (12.0 / 1_000_000),
    quality: 92,  // GPQA Diamond
    speed: 138,
  },
  {
    id: "x-ai/grok-4.1-fast",
    name: "Grok 4.1 Fast",
    provider: "xAI",
    color: "#A0A0A0",
    inputPrice: (0.20 / 1_000_000),
    outputPrice: (0.50 / 1_000_000),
    quality: 86,  // GPQA Diamond (est. from Grok 4 Fast 85.7%)
    speed: 129,
  },
  {
    id: "deepseek/deepseek-chat-v3-0324",
    name: "DeepSeek V3",
    provider: "DeepSeek",
    color: "#4D6BFE",
    inputPrice: (0.27 / 1_000_000),
    outputPrice: (1.10 / 1_000_000),
    quality: 59,  // GPQA Diamond
    speed: 50,
  },
];

/** Virtual model entry for debate receipts — not in the picker */
export const DEBATE_MODEL: ModelConfig = {
  id: "debate",
  name: "Meter 1.0",
  provider: "Meter",
  color: "#E4E4E7",
  inputPrice: (3.0 / 1_000_000),
  outputPrice: (15.0 / 1_000_000),
};

/** Virtual model entry for dissect receipts — not in the picker */
export const DISSECT_MODEL: ModelConfig = {
  id: "dissect",
  name: "Meter 1.0",
  provider: "Meter",
  color: "#E4E4E7",
  inputPrice: (5.0 / 1_000_000),
  outputPrice: (25.0 / 1_000_000),
};

export const DEFAULT_MODEL = MODELS[0];

/** Models the user can check in the model picker (everything except "auto") */
export const SELECTABLE_MODELS = MODELS.filter((m) => m.id !== "auto");

/** @deprecated — use DEFAULT_DEBATE_MODELS */
export const DEBATE_MODELS = DEFAULT_DEBATE_MODELS;

export function getModel(id: string): ModelConfig {
  if (id === "debate") return DEBATE_MODEL;
  if (id === "dissect") return DISSECT_MODEL;
  return MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;
}

export function shortModelName(id: string): string {
  return getModel(id).name;
}
