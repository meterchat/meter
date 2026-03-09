import React, { createContext, useContext, useRef } from "react";
import { MeterClient } from "@meterxyz/sdk";
import type { MeterProviderConfig, MeterModel } from "./types";

interface MeterContextValue {
  client: MeterClient;
  config: MeterProviderConfig;
  models: MeterModel[];
}

const MeterContext = createContext<MeterContextValue | null>(null);

const DEFAULT_MODELS: MeterModel[] = [
  { id: "auto", name: "Auto", provider: "Meter", inputPrice: 2.50 / 1_000_000, outputPrice: 15.0 / 1_000_000 },
  { id: "anthropic/claude-sonnet-4.6", name: "Sonnet 4.6", provider: "Anthropic", inputPrice: 3.0 / 1_000_000, outputPrice: 15.0 / 1_000_000 },
  { id: "anthropic/claude-opus-4.6", name: "Opus 4.6", provider: "Anthropic", inputPrice: 5.0 / 1_000_000, outputPrice: 25.0 / 1_000_000 },
  { id: "openai/gpt-5.4", name: "GPT-5.4", provider: "OpenAI", inputPrice: 2.50 / 1_000_000, outputPrice: 15.0 / 1_000_000 },
  { id: "minimax/minimax-m2.5", name: "MiniMax M2.5", provider: "MiniMax", inputPrice: 0.30 / 1_000_000, outputPrice: 1.20 / 1_000_000 },
  { id: "google/gemini-3.1-pro-preview", name: "Gemini 3.1 Pro", provider: "Google", inputPrice: 2.0 / 1_000_000, outputPrice: 12.0 / 1_000_000 },
  { id: "x-ai/grok-4.1-fast", name: "Grok 4.1 Fast", provider: "xAI", inputPrice: 0.20 / 1_000_000, outputPrice: 0.50 / 1_000_000 },
  { id: "deepseek/deepseek-chat-v3-0324", name: "DeepSeek V3", provider: "DeepSeek", inputPrice: 0.27 / 1_000_000, outputPrice: 1.10 / 1_000_000 },
];

export function MeterProvider({
  children,
  ...config
}: MeterProviderConfig & { children: React.ReactNode }) {
  const clientRef = useRef<MeterClient | null>(null);
  if (!clientRef.current) {
    clientRef.current = new MeterClient({
      apiKey: config.apiKey,
      baseUrl: config.baseUrl,
    });
  }

  const value: MeterContextValue = {
    client: clientRef.current,
    config,
    models: config.models ?? DEFAULT_MODELS,
  };

  return (
    <MeterContext.Provider value={value}>
      {children}
    </MeterContext.Provider>
  );
}

export function useMeterContext(): MeterContextValue {
  const ctx = useContext(MeterContext);
  if (!ctx)
    throw new Error("useMeterContext must be used inside <MeterProvider>");
  return ctx;
}
