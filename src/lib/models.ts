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

/** Models used in Meter 1.0 debate mode (fixed roster) */
export const DEBATE_MODELS = [
  "anthropic/claude-opus-4.6",
  "openai/gpt-5.2",
  "x-ai/grok-4.1-fast",
] as const;

export const MODELS: ModelConfig[] = [
  {
    id: "auto",
    name: "Auto",
    provider: "Meter",
    color: "#A1A1AA",
    inputPrice: (1.75 / 1_000_000),
    outputPrice: (14.0 / 1_000_000),
    quality: 90,  // GPQA Diamond — routes to GPT-5.2
    speed: 84,
  },
  {
    id: "meter-1.0",
    name: "Meter 1.0",
    provider: "Meter",
    color: "#F59E0B",
    // Display-only blended rate (NOT used for billing — debate cost is
    // computed per-model in debate.ts and sent as actualCost).
    inputPrice: (6.95 / 1_000_000),
    outputPrice: (39.50 / 1_000_000),
    quality: 93,  // GPQA Diamond — multi-model ensemble exceeds best individual
    speed: 30,
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
    id: "openai/gpt-5.2",
    name: "GPT-5.2",
    provider: "OpenAI",
    color: "#10A37F",
    inputPrice: (1.75 / 1_000_000),
    outputPrice: (14.0 / 1_000_000),
    quality: 90,  // GPQA Diamond
    speed: 84,
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

export const DEFAULT_MODEL = MODELS[0];

export function getModel(id: string): ModelConfig {
  return MODELS.find((m) => m.id === id) ?? DEFAULT_MODEL;
}

export function shortModelName(id: string): string {
  return getModel(id).name;
}
