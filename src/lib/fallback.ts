/**
 * Multi-tier fallback streaming for Meter.
 *
 * Tier 1: OpenRouter (user's selected model)
 * Tier 2: Same model via direct API key (CLAUDE_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY) — silent
 * Tier 3: Auto-route to a different model via direct key — sends "rerouting" event to client
 *
 * If all tiers fail, sends a final error event.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import { GoogleGenerativeAI, type Content } from "@google/generative-ai";
import type { ToolDef } from "./tools";

/* ─── Types ─────────────────────────────────────────────────────── */

type Message = OpenAI.Chat.ChatCompletionMessageParam;

export type StreamEvent = Record<string, unknown>;
export type Send = (data: StreamEvent) => void;

/** Return true if the error is retryable (rate limit, capacity, server error) */
function isRetryable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; type?: string; message?: string };
  const status = e.status ?? 0;
  const msg = (e.message ?? "").toLowerCase();
  if (status === 429 || status === 503 || status >= 500) return true;
  if (e.code === "rate_limit_exceeded" || e.type === "rate_limit_error") return true;
  if (/rate.?limit|too many request|throttl|capacity|overloaded|unavailable/i.test(msg)) return true;
  return false;
}

/* ─── Provider mapping ──────────────────────────────────────────── */

/** Maps OpenRouter model prefixes to direct API env var + native model ID */
interface DirectProvider {
  envKey: string;
  /** The native model ID to use with the direct API */
  nativeModel: string;
  sdk: "anthropic" | "openai" | "gemini";
  /** Custom base URL for OpenAI-compatible APIs (e.g. DeepSeek) */
  baseURL?: string;
  /** Cache read discount rate (fraction of input price). OpenAI=0.5, Anthropic/Gemini/DeepSeek=0.1 */
  cacheReadRate?: number;
}

const DIRECT_PROVIDERS: Record<string, DirectProvider> = {
  "anthropic/claude-sonnet-4.6": { envKey: "CLAUDE_API_KEY", nativeModel: "claude-sonnet-4-6", sdk: "anthropic", cacheReadRate: 0.1 },
  "anthropic/claude-opus-4.6": { envKey: "CLAUDE_API_KEY", nativeModel: "claude-opus-4-6", sdk: "anthropic", cacheReadRate: 0.1 },
  "openai/gpt-5.2": { envKey: "OPENAI_API_KEY", nativeModel: "gpt-5.2", sdk: "openai", cacheReadRate: 0.5 },
  "google/gemini-3-pro-preview": { envKey: "GEMINI_API_KEY", nativeModel: "gemini-3-pro-preview", sdk: "gemini", cacheReadRate: 0.25 },
  "x-ai/grok-4.1-fast": { envKey: "XAI_API_KEY", nativeModel: "grok-4.1-fast", sdk: "openai", baseURL: "https://api.x.ai/v1", cacheReadRate: 0.25 },
  "deepseek/deepseek-chat-v3-0324": { envKey: "DEEPSEEK_API_KEY", nativeModel: "deepseek-chat", sdk: "openai", baseURL: "https://api.deepseek.com", cacheReadRate: 0.1 },
};

/** Models where direct API should be preferred over OpenRouter.
 *  Empty — OpenRouter is now primary for all models (supports caching natively). */
const PREFER_DIRECT: Set<string> = new Set([]);

/** Models that support cache_control breakpoints on OpenRouter */
function supportsCacheControl(model: string): boolean {
  return model.startsWith("anthropic/") || model.startsWith("google/");
}

/**
 * Auto-route fallback order: when all tiers for the original model fail,
 * try these models in order (skipping the original).
 */
const AUTO_ROUTE_ORDER = [
  "anthropic/claude-sonnet-4.6",
  "openai/gpt-5.2",
  "google/gemini-3-pro-preview",
];

/* ─── Streaming adapters ────────────────────────────────────────── */

/**
 * Add cache_control breakpoints to conversation messages for OpenRouter.
 * Converts system prompt and 2nd-to-last user message to multipart format
 * with cache_control: { type: "ephemeral" } for Anthropic/Gemini caching.
 */
function addOpenRouterCacheBreakpoints(conversation: Message[]): Message[] {
  const msgs = conversation.map((m) => ({ ...m }));

  // 1. System prompt → multipart with cache_control
  for (let i = 0; i < msgs.length; i++) {
    if (msgs[i].role === "system" && typeof msgs[i].content === "string") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      msgs[i] = {
        ...msgs[i],
        content: [
          { type: "text", text: msgs[i].content as string, cache_control: { type: "ephemeral" } },
        ] as any,
      };
      break;
    }
  }

  // 2. Second-to-last user message → cache breakpoint (caches all prior conversation)
  let userCount = 0;
  for (let i = msgs.length - 1; i >= 0; i--) {
    if (msgs[i].role === "user") {
      userCount++;
      if (userCount === 2 && typeof msgs[i].content === "string") {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        msgs[i] = {
          ...msgs[i],
          content: [
            { type: "text", text: msgs[i].content as string, cache_control: { type: "ephemeral" } },
          ] as any,
        };
        break;
      }
    }
  }

  return msgs;
}

/**
 * Stream via OpenRouter (Tier 1). Uses OpenAI SDK pointed at OpenRouter.
 * Yields delta events. Throws on error.
 */
export async function streamOpenRouter(
  model: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
  });

  // Add cache_control breakpoints for Anthropic/Gemini models on OpenRouter
  const cachedConversation = supportsCacheControl(model)
    ? addOpenRouterCacheBreakpoints(conversation)
    : conversation;

  // Determine cache read rate for this model's provider.
  // Anthropic=0.1x, Gemini=0.25x (implicit), DeepSeek=0.1x, OpenAI=0.5x
  const orCacheRate = model.startsWith("anthropic/") ? 0.1
    : model.startsWith("google/") ? 0.25
    : model.startsWith("deepseek/") ? 0.1
    : model.startsWith("openai/") ? 0.5
    : model.startsWith("x-ai/") ? 0.25
    : undefined;

  const response = await client.chat.completions.create({
    model,
    messages: cachedConversation,
    tools,
    stream: true,
    stream_options: { include_usage: true },
  });

  let textContent = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let hasToolCalls = false;

  for await (const chunk of response) {
    const choice = chunk.choices?.[0];
    if (!choice) {
      if (chunk.usage) {
        const totalIn = chunk.usage.prompt_tokens ?? 0;
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (chunk.usage as any).prompt_tokens_details;
        const cachedTokens = details?.cached_tokens as number | undefined ?? 0;
        const cacheWriteTokens = details?.cache_write_tokens as number | undefined ?? 0;
        send({
          type: "usage",
          tokensIn: totalIn,
          tokensOut: chunk.usage.completion_tokens,
          cacheCreationTokens: cacheWriteTokens || undefined,
          cacheReadTokens: cachedTokens || undefined,
          cacheReadRate: (cachedTokens || cacheWriteTokens) && orCacheRate ? orCacheRate : undefined,
        });
      }
      continue;
    }

    const delta = choice.delta?.content || "";
    if (delta) {
      textContent += delta;
      totalTokensOut.value += estimateTokens(delta);
      send({ type: "delta", content: delta, tokensOut: totalTokensOut.value });
    }

    if (choice.delta?.tool_calls) {
      hasToolCalls = true;
      for (const tc of choice.delta.tool_calls) {
        const existing = toolCalls.get(tc.index) || { id: "", name: "", arguments: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        toolCalls.set(tc.index, existing);
      }
    }

    if (chunk.usage) {
      const totalIn = chunk.usage.prompt_tokens ?? 0;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = (chunk.usage as any).prompt_tokens_details;
      const cachedTokens = details?.cached_tokens as number | undefined ?? 0;
      const cacheWriteTokens = details?.cache_write_tokens as number | undefined ?? 0;
      send({
        type: "usage",
        tokensIn: totalIn,
        tokensOut: chunk.usage.completion_tokens,
        cacheCreationTokens: cacheWriteTokens || undefined,
        cacheReadTokens: cachedTokens || undefined,
        cacheReadRate: (cachedTokens || cacheWriteTokens) && orCacheRate ? orCacheRate : undefined,
      });
    }
  }

  return { textContent, toolCalls, hasToolCalls };
}

/**
 * Stream via direct Anthropic API (Tier 2). Uses @anthropic-ai/sdk.
 */
async function streamAnthropic(
  nativeModel: string,
  apiKey: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = new Anthropic({ apiKey });

  // Convert OpenAI message format to Anthropic format
  const systemMsg = conversation.find((m) => m.role === "system");
  const systemText = typeof systemMsg?.content === "string" ? systemMsg.content : "";
  const msgs: Anthropic.MessageParam[] = [];
  for (const m of conversation) {
    if (m.role === "system") continue;

    if (m.role === "assistant") {
      const text = typeof m.content === "string" ? m.content : "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls = (m as any).tool_calls as
        | { id: string; function: { name: string; arguments: string } }[]
        | undefined;

      if (toolCalls && toolCalls.length > 0) {
        // Assistant message with tool calls → use content block array
        const content: Anthropic.ContentBlockParam[] = [];
        if (text) content.push({ type: "text", text });
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* malformed */ }
          content.push({ type: "tool_use", id: tc.id, name: tc.function.name, input });
        }
        msgs.push({ role: "assistant", content });
      } else if (text) {
        msgs.push({ role: "assistant", content: text });
      }
    } else if (m.role === "tool") {
      // Tool result → convert to Anthropic tool_result in a user message
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCallId = (m as any).tool_call_id as string;
      const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
      const toolResult: Anthropic.ToolResultBlockParam = {
        type: "tool_result",
        tool_use_id: toolCallId,
        content: text,
      };
      // Merge consecutive tool results into one user message (Anthropic requires alternating roles)
      const last = msgs[msgs.length - 1];
      if (last?.role === "user" && Array.isArray(last.content)) {
        (last.content as Anthropic.ToolResultBlockParam[]).push(toolResult);
      } else {
        msgs.push({ role: "user", content: [toolResult] });
      }
    } else {
      // User message
      const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
      msgs.push({ role: "user", content: text });
    }
  }

  // ── Prompt caching: add cache breakpoints to conversation history ──
  // Anthropic allows up to 4 breakpoints. Everything up to and including
  // the breakpoint is cached. Strategy:
  //   - System prompt (already has cache_control)
  //   - Tool definitions (if any)
  //   - The second-to-last user turn (caches all prior conversation)
  // This way, on each new user message in the same conversation,
  // all prior turns are served from cache at 0.1x cost.
  if (msgs.length >= 3) {
    // Find the second-to-last user message to place a cache breakpoint
    let cacheIdx = -1;
    let userCount = 0;
    for (let i = msgs.length - 1; i >= 0; i--) {
      if (msgs[i].role === "user") {
        userCount++;
        if (userCount === 2) {
          cacheIdx = i;
          break;
        }
      }
    }

    if (cacheIdx >= 0) {
      const msg = msgs[cacheIdx];
      if (typeof msg.content === "string") {
        // Convert string content to content block with cache_control
        msgs[cacheIdx] = {
          ...msg,
          content: [
            { type: "text", text: msg.content, cache_control: { type: "ephemeral" } } as Anthropic.TextBlockParam,
          ],
        };
      } else if (Array.isArray(msg.content) && msg.content.length > 0) {
        // Add cache_control to the last content block
        const blocks = [...msg.content];
        const lastBlock = { ...blocks[blocks.length - 1] };
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (lastBlock as any).cache_control = { type: "ephemeral" };
        blocks[blocks.length - 1] = lastBlock as Anthropic.ContentBlockParam;
        msgs[cacheIdx] = { ...msg, content: blocks };
      }
    }
  }

  // Convert tool defs to Anthropic format
  const anthropicTools = tools.map((t) => ({
    name: t.function.name,
    description: t.function.description,
    input_schema: t.function.parameters as Anthropic.Tool.InputSchema,
  }));

  // Add cache_control to last tool definition (caches system + tools together)
  if (anthropicTools.length > 0) {
    const lastTool = anthropicTools[anthropicTools.length - 1];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (lastTool as any).cache_control = { type: "ephemeral" };
  }

  const stream = await client.messages.stream({
    model: nativeModel,
    max_tokens: 8192,
    system: [{ type: "text", text: systemText, cache_control: { type: "ephemeral" } }],
    messages: msgs,
    tools: anthropicTools,
  });

  let textContent = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let hasToolCalls = false;
  let toolIdx = 0;

  for await (const event of stream) {
    if (event.type === "content_block_delta") {
      if (event.delta.type === "text_delta") {
        const delta = event.delta.text;
        textContent += delta;
        totalTokensOut.value += estimateTokens(delta);
        send({ type: "delta", content: delta, tokensOut: totalTokensOut.value });
      } else if (event.delta.type === "input_json_delta") {
        const existing = toolCalls.get(toolIdx - 1);
        if (existing) existing.arguments += event.delta.partial_json;
      }
    } else if (event.type === "content_block_start") {
      if (event.content_block.type === "tool_use") {
        hasToolCalls = true;
        toolCalls.set(toolIdx, { id: event.content_block.id, name: event.content_block.name, arguments: "" });
        toolIdx++;
      }
    }
  }

  // Use finalMessage for complete usage data.
  // Anthropic reports tokens in three buckets:
  //   input_tokens: uncached input (standard rate)
  //   cache_creation_input_tokens: written to cache (1.25x rate)
  //   cache_read_input_tokens: read from cache (0.1x rate)
  // We report total input tokens for display, but send the breakdown
  // so the frontend can compute accurate cost.
  const finalMessage = await stream.finalMessage();
  if (finalMessage.usage) {
    const u = finalMessage.usage;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheCreation = (u as any).cache_creation_input_tokens as number | undefined ?? 0;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cacheRead = (u as any).cache_read_input_tokens as number | undefined ?? 0;
    const uncachedIn = u.input_tokens;
    const totalIn = uncachedIn + cacheCreation + cacheRead;

    send({
      type: "usage",
      tokensIn: totalIn,
      tokensOut: u.output_tokens,
      // Cache breakdown for accurate cost calculation
      cacheCreationTokens: cacheCreation,
      cacheReadTokens: cacheRead,
      cacheReadRate: cacheRead ? 0.1 : undefined,
    });
  }

  return { textContent, toolCalls, hasToolCalls };
}

/**
 * Stream via direct OpenAI API (Tier 2). Uses openai SDK with default base URL.
 */
async function streamOpenAIDirect(
  nativeModel: string,
  apiKey: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
  baseURL?: string,
  cacheReadRate?: number,
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}) });

  const response = await client.chat.completions.create({
    model: nativeModel,
    messages: conversation,
    tools,
    stream: true,
    stream_options: { include_usage: true },
  });

  let textContent = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let hasToolCalls = false;

  for await (const chunk of response) {
    const choice = chunk.choices?.[0];
    if (!choice) {
      if (chunk.usage) {
        // OpenAI/DeepSeek automatic prompt caching — report cache breakdown.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const details = (chunk.usage as any).prompt_tokens_details;
        const cachedTokens = details?.cached_tokens as number | undefined ?? 0;
        const totalIn = chunk.usage.prompt_tokens ?? 0;
        send({
          type: "usage",
          tokensIn: totalIn,
          tokensOut: chunk.usage.completion_tokens,
          cacheReadTokens: cachedTokens || undefined,
          cacheReadRate: cachedTokens ? (cacheReadRate ?? 0.5) : undefined,
        });
      }
      continue;
    }

    const delta = choice.delta?.content || "";
    if (delta) {
      textContent += delta;
      totalTokensOut.value += estimateTokens(delta);
      send({ type: "delta", content: delta, tokensOut: totalTokensOut.value });
    }

    if (choice.delta?.tool_calls) {
      hasToolCalls = true;
      for (const tc of choice.delta.tool_calls) {
        const existing = toolCalls.get(tc.index) || { id: "", name: "", arguments: "" };
        if (tc.id) existing.id = tc.id;
        if (tc.function?.name) existing.name = tc.function.name;
        if (tc.function?.arguments) existing.arguments += tc.function.arguments;
        toolCalls.set(tc.index, existing);
      }
    }

    if (chunk.usage) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const details = (chunk.usage as any).prompt_tokens_details;
      const cachedTokens = details?.cached_tokens as number | undefined ?? 0;
      const totalIn = chunk.usage.prompt_tokens ?? 0;
      send({
        type: "usage",
        tokensIn: totalIn,
        tokensOut: chunk.usage.completion_tokens,
        cacheReadTokens: cachedTokens || undefined,
        cacheReadRate: cachedTokens ? (cacheReadRate ?? 0.5) : undefined,
      });
    }
  }

  return { textContent, toolCalls, hasToolCalls };
}

/**
 * Stream via Google Gemini API (Tier 2). Uses @google/generative-ai.
 * Note: Gemini doesn't support OpenAI-style tool calling in the same way,
 * so we stream text only for the fallback path.
 */
async function streamGemini(
  nativeModel: string,
  apiKey: string,
  conversation: Message[],
  _tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: nativeModel });

  // Convert messages to Gemini format
  const systemMsg = conversation.find((m) => m.role === "system");
  const systemText = typeof systemMsg?.content === "string" ? systemMsg.content : "";

  const contents: Content[] = [];
  for (const m of conversation) {
    if (m.role === "system") continue;
    const text = typeof m.content === "string" ? m.content : "";
    if (!text) continue;
    contents.push({
      role: m.role === "assistant" ? "model" : "user",
      parts: [{ text }],
    });
  }

  const result = await model.generateContentStream({
    contents,
    systemInstruction: systemText ? { role: "user", parts: [{ text: systemText }] } : undefined,
  });

  let textContent = "";

  for await (const chunk of result.stream) {
    const text = chunk.text();
    if (text) {
      textContent += text;
      totalTokensOut.value += estimateTokens(text);
      send({ type: "delta", content: text, tokensOut: totalTokensOut.value });
    }
  }

  const response = await result.response;
  if (response.usageMetadata) {
    // Gemini has implicit caching (75% discount / 0.25x rate).
    // cachedContentTokenCount is included in promptTokenCount.
    const cachedTokens = response.usageMetadata.cachedContentTokenCount ?? 0;
    send({
      type: "usage",
      tokensIn: response.usageMetadata.promptTokenCount,
      tokensOut: response.usageMetadata.candidatesTokenCount,
      cacheReadTokens: cachedTokens || undefined,
      cacheReadRate: cachedTokens ? 0.25 : undefined,
    });
  }

  // Gemini fallback doesn't do tool calls
  return { textContent, toolCalls: new Map(), hasToolCalls: false };
}

/* ─── Direct API dispatcher ─────────────────────────────────────── */

function streamDirect(
  provider: DirectProvider,
  apiKey: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
) {
  switch (provider.sdk) {
    case "anthropic":
      return streamAnthropic(provider.nativeModel, apiKey, conversation, tools, send, estimateTokens, totalTokensOut);
    case "openai":
      return streamOpenAIDirect(provider.nativeModel, apiKey, conversation, tools, send, estimateTokens, totalTokensOut, provider.baseURL, provider.cacheReadRate);
    case "gemini":
      return streamGemini(provider.nativeModel, apiKey, conversation, tools, send, estimateTokens, totalTokensOut);
  }
}

/* ─── Main fallback orchestrator ────────────────────────────────── */

export interface FallbackResult {
  textContent: string;
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  hasToolCalls: boolean;
  /** Which model actually served the response */
  actualModel: string;
  /** Which tier succeeded: 1=openrouter, 2=direct-same-model, 3=auto-route */
  tier: number;
}

/**
 * Attempt to stream a response with multi-tier fallback.
 *
 * Tier 1: OpenRouter with the requested model
 * Tier 2: Same model via direct API key (silent — no client notification)
 * Tier 3: Different model via direct API key (sends "rerouting" event)
 *
 * Throws only if ALL tiers fail.
 */
export async function streamWithFallback(
  requestedModel: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
): Promise<FallbackResult> {
  const errors: { tier: number; model: string; error: string }[] = [];

  const directProvider = DIRECT_PROVIDERS[requestedModel];
  const directKey = directProvider ? process.env[directProvider.envKey] : undefined;
  const preferDirect = PREFER_DIRECT.has(requestedModel) && directProvider && directKey;

  // ── For Anthropic models: try direct API FIRST (enables prompt caching) ──
  if (preferDirect) {
    try {
      console.log("[fallback] tier 1 (direct, preferred for caching):", requestedModel);
      const result = await streamDirect(directProvider, directKey!, conversation, tools, send, estimateTokens, totalTokensOut);
      return { ...result, actualModel: requestedModel, tier: 2 };
    } catch (err) {
      const e = err as Error;
      console.error("[fallback] tier 1 direct (preferred) failed:", requestedModel, e.message);
      errors.push({ tier: 2, model: requestedModel, error: e.message });
    }
  }

  // ── Tier 1: OpenRouter ──────────────────────────────────────────
  if (process.env.OPENROUTER_API_KEY) {
    try {
      const result = await streamOpenRouter(requestedModel, conversation, tools, send, estimateTokens, totalTokensOut);
      return { ...result, actualModel: requestedModel, tier: 1 };
    } catch (err) {
      const e = err as Error;
      console.error("[fallback] tier 1 (openrouter) failed:", requestedModel, e.message);
      errors.push({ tier: 1, model: requestedModel, error: e.message });

      if (!isRetryable(err)) {
        // Non-retryable (auth, bad request) — still try direct key for same model
      }
    }
  }

  // ── Tier 2: Same model via direct API key (silent) ──────────────
  // Skip if already tried above as preferred direct
  if (!preferDirect && directProvider && directKey) {
    try {
      console.log("[fallback] tier 2 (direct key, same model):", requestedModel);
      const result = await streamDirect(directProvider, directKey, conversation, tools, send, estimateTokens, totalTokensOut);
      return { ...result, actualModel: requestedModel, tier: 2 };
    } catch (err) {
      const e = err as Error;
      console.error("[fallback] tier 2 (direct) failed:", requestedModel, e.message);
      errors.push({ tier: 2, model: requestedModel, error: e.message });
    }
  }

  // ── Tier 3: Auto-route to a different model ─────────────────────
  // For each candidate, try OpenRouter first, then direct key (mirrors Tier 1→2).
  const candidates = AUTO_ROUTE_ORDER.filter((m) => m !== requestedModel);

  for (const candidateModel of candidates) {
    const candidateProvider = DIRECT_PROVIDERS[candidateModel];
    const candidateKey = candidateProvider ? process.env[candidateProvider.envKey] : undefined;

    // Notify client about the reroute
    const providerName = requestedModel.split("/")[0];
    const providerLabel = providerName.charAt(0).toUpperCase() + providerName.slice(1);

    // Try OpenRouter first for this candidate
    if (process.env.OPENROUTER_API_KEY) {
      try {
        console.log("[fallback] tier 3 (openrouter, auto-route):", candidateModel);
        send({ type: "rerouting", from: requestedModel, to: candidateModel, provider: providerLabel });
        const result = await streamOpenRouter(candidateModel, conversation, tools, send, estimateTokens, totalTokensOut);
        return { ...result, actualModel: candidateModel, tier: 3 };
      } catch (err) {
        const e = err as Error;
        console.error("[fallback] tier 3 openrouter failed:", candidateModel, e.message);
        errors.push({ tier: 3, model: candidateModel, error: e.message });
      }
    }

    // Then try direct key for this candidate
    if (candidateProvider && candidateKey) {
      try {
        console.log("[fallback] tier 3 (direct, auto-route):", candidateModel);
        send({ type: "rerouting", from: requestedModel, to: candidateModel, provider: providerLabel });
        const result = await streamDirect(candidateProvider, candidateKey, conversation, tools, send, estimateTokens, totalTokensOut);
        return { ...result, actualModel: candidateModel, tier: 3 };
      } catch (err) {
        const e = err as Error;
        console.error("[fallback] tier 3 direct failed:", candidateModel, e.message);
        errors.push({ tier: 3, model: candidateModel, error: e.message });
      }
    }
  }

  // All tiers exhausted
  console.error("[fallback] all tiers failed:", JSON.stringify(errors));
  throw new Error("All model providers failed");
}
