/**
 * Multi-tier fallback streaming for Meter.
 *
 * Tier 1: Direct API key (OPENAI_API_KEY / CLAUDE_API_KEY / GEMINI_API_KEY / etc.) — uses free credits
 * Tier 2: OpenRouter (same model) — fallback if direct key missing or fails
 * Tier 3: AWS Bedrock (Claude models only) — silent
 * Tier 4: Auto-route to a different model (direct → OpenRouter → Bedrock) — sends "rerouting" event
 *
 * If all tiers fail, sends a final error event.
 */

import OpenAI from "openai";
import Anthropic from "@anthropic-ai/sdk";
import {
  BedrockRuntimeClient,
  ConverseStreamCommand,
  type Message as BedrockMessage,
  type ContentBlock as BedrockContentBlock,
  type SystemContentBlock,
  type Tool as BedrockTool,
  type ToolInputSchema,
} from "@aws-sdk/client-bedrock-runtime";
import { GoogleGenerativeAI, type Content, type Part, type FunctionDeclarationSchema } from "@google/generative-ai";
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
  "openai/gpt-5.4": { envKey: "OPENAI_API_KEY", nativeModel: "gpt-5.4", sdk: "openai", cacheReadRate: 0.5 },
  "google/gemini-3.1-pro-preview": { envKey: "GEMINI_API_KEY", nativeModel: "gemini-3.1-pro-preview", sdk: "gemini", cacheReadRate: 0.25 },
  "x-ai/grok-4.1-fast": { envKey: "XAI_API_KEY", nativeModel: "grok-4-1-fast", sdk: "openai", baseURL: "https://api.x.ai/v1", cacheReadRate: 0.25 },
  "deepseek/deepseek-chat-v3-0324": { envKey: "DEEPSEEK_API_KEY", nativeModel: "deepseek-chat", sdk: "openai", baseURL: "https://api.deepseek.com", cacheReadRate: 0.1 },
};

/* ─── Bedrock provider (Claude models via AWS) ─────────────────── */

/** Maps OpenRouter model IDs to AWS Bedrock cross-region inference profile IDs */
const BEDROCK_MODELS: Record<string, string> = {
  "anthropic/claude-sonnet-4.6": "us.anthropic.claude-sonnet-4-6",
  "anthropic/claude-opus-4.6": "us.anthropic.claude-opus-4-6-v1",
};

/** Check whether AWS Bedrock API key is configured */
function isBedrockAvailable(): boolean {
  return !!(process.env.BEDROCK_API_KEY || process.env.AWS_BEARER_TOKEN_BEDROCK);
}

/** Build a BedrockRuntimeClient using bearer token auth (Bedrock API key) */
function createBedrockClient(): BedrockRuntimeClient {
  // The AWS SDK reads AWS_BEARER_TOKEN_BEDROCK for bearer auth.
  // Map BEDROCK_API_KEY → AWS_BEARER_TOKEN_BEDROCK so the SDK picks it up.
  if (process.env.BEDROCK_API_KEY && !process.env.AWS_BEARER_TOKEN_BEDROCK) {
    process.env.AWS_BEARER_TOKEN_BEDROCK = process.env.BEDROCK_API_KEY;
  }
  return new BedrockRuntimeClient({
    region: process.env.AWS_REGION ?? "us-east-1",
  });
}

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
  "openai/gpt-5.4",
  "google/gemini-3.1-pro-preview",
  "x-ai/grok-4.1-fast",
  "deepseek/deepseek-chat-v3-0324",
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
  timeoutMs?: number,
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = new OpenAI({
    apiKey: process.env.OPENROUTER_API_KEY,
    baseURL: "https://openrouter.ai/api/v1",
    timeout: timeoutMs ?? 600_000,
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

  // Enable reasoning for models that support it
  const isOpenAIReasoning = model.startsWith("openai/");
  const isXAIReasoning = model.startsWith("x-ai/");

  const response = await client.chat.completions.create({
    model,
    messages: cachedConversation,
    ...(tools.length > 0 ? { tools } : {}),
    max_tokens: 16384,
    stream: true,
    stream_options: { include_usage: true },
    // GPT-5.4 / Grok reasoning
    ...(isOpenAIReasoning || isXAIReasoning ? { reasoning_effort: "medium" } : {}),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

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

    // DeepSeek/OpenAI reasoning_content (passthrough via OpenRouter)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reasoning = (choice.delta as any)?.reasoning_content;
    if (reasoning) send({ type: "thinking_delta", content: reasoning });

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

  // Empty response with no tool calls — treat as failure so fallback kicks in
  if (!textContent && !hasToolCalls) {
    throw new Error("Model returned empty response");
  }

  return { textContent, toolCalls, hasToolCalls };
}

/**
 * Core streaming logic for Anthropic-protocol APIs (direct Anthropic + Bedrock).
 * Accepts a pre-built client (Anthropic or AnthropicBedrock).
 */
async function _streamAnthropicProtocol(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  nativeModel: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {

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
      // User message — may be multimodal (content array with image_url parts)
      if (Array.isArray(m.content)) {
        const blocks: Anthropic.ContentBlockParam[] = [];
        for (const part of m.content) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = part as any;
          if (p.type === "text") {
            blocks.push({ type: "text", text: p.text });
          } else if (p.type === "image_url") {
            const url: string = p.image_url?.url ?? "";
            if (url.startsWith("data:application/pdf;base64,")) {
              // PDF → Anthropic document block
              const b64 = url.replace("data:application/pdf;base64,", "");
              blocks.push({
                type: "document",
                source: { type: "base64", media_type: "application/pdf", data: b64 },
              } as Anthropic.ContentBlockParam);
            } else if (url.startsWith("data:")) {
              // Base64 image
              const match = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
              if (match) {
                blocks.push({
                  type: "image",
                  source: { type: "base64", media_type: match[1] as "image/jpeg" | "image/png" | "image/gif" | "image/webp", data: match[2] },
                });
              }
            } else {
              // URL image
              blocks.push({ type: "image", source: { type: "url", url } } as Anthropic.ContentBlockParam);
            }
          }
        }
        if (blocks.length > 0) msgs.push({ role: "user", content: blocks });
      } else {
        const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
        msgs.push({ role: "user", content: text });
      }
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
    max_tokens: 16384,
    thinking: { type: "enabled", budget_tokens: 4096 },
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
      } else if (event.delta.type === "thinking_delta") {
        send({ type: "thinking_delta", content: event.delta.thinking });
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

  if (!textContent && !hasToolCalls) {
    throw new Error("Model returned empty response");
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
  timeoutMs?: number,
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = new Anthropic({ apiKey, timeout: timeoutMs ?? 600_000 });
  return _streamAnthropicProtocol(client, nativeModel, conversation, tools, send, estimateTokens, totalTokensOut);
}

/**
 * Stream via AWS Bedrock Converse API (Tier 3).
 * Uses bearer token auth (Bedrock API key) with ConverseStreamCommand.
 */
async function streamBedrock(
  bedrockModelId: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = createBedrockClient();

  // ── Convert OpenAI messages to Bedrock Converse format ──
  const systemBlocks: SystemContentBlock[] = [];
  const bedrockMessages: BedrockMessage[] = [];

  for (const m of conversation) {
    if (m.role === "system") {
      const text = typeof m.content === "string" ? m.content : "";
      if (text) systemBlocks.push({ text });
      continue;
    }

    if (m.role === "assistant") {
      const text = typeof m.content === "string" ? m.content : "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCalls = (m as any).tool_calls as
        | { id: string; function: { name: string; arguments: string } }[]
        | undefined;

      const content: BedrockContentBlock[] = [];
      if (text) content.push({ text });
      if (toolCalls) {
        for (const tc of toolCalls) {
          let input: Record<string, unknown> = {};
          try { input = JSON.parse(tc.function.arguments); } catch { /* malformed */ }
          content.push({
            toolUse: { toolUseId: tc.id, name: tc.function.name, input: input as unknown as import("@smithy/types").DocumentType },
          });
        }
      }
      if (content.length > 0) bedrockMessages.push({ role: "assistant", content });
    } else if (m.role === "tool") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCallId = (m as any).tool_call_id as string;
      const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
      const toolResult: BedrockContentBlock = {
        toolResult: {
          toolUseId: toolCallId,
          content: [{ text }],
        },
      };
      // Merge consecutive tool results into one user message (Bedrock requires alternating roles)
      const last = bedrockMessages[bedrockMessages.length - 1];
      if (last?.role === "user" && last.content) {
        last.content.push(toolResult);
      } else {
        bedrockMessages.push({ role: "user", content: [toolResult] });
      }
    } else {
      // User message — may be multimodal
      const content: BedrockContentBlock[] = [];
      if (Array.isArray(m.content)) {
        for (const part of m.content) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = part as any;
          if (p.type === "text") {
            content.push({ text: p.text });
          } else if (p.type === "image_url") {
            const url: string = p.image_url?.url ?? "";
            const dataMatch = url.match(/^data:(image\/[^;]+);base64,(.+)$/);
            if (dataMatch) {
              const format = dataMatch[1].split("/")[1] as "jpeg" | "png" | "gif" | "webp";
              content.push({
                image: { format, source: { bytes: Buffer.from(dataMatch[2], "base64") } },
              });
            }
          }
        }
      } else {
        const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
        if (text) content.push({ text });
      }
      if (content.length > 0) bedrockMessages.push({ role: "user", content });
    }
  }

  // ── Convert tools to Bedrock format ──
  const bedrockTools: BedrockTool[] = tools.map((t) => ({
    toolSpec: {
      name: t.function.name,
      description: t.function.description,
      inputSchema: { json: t.function.parameters } as ToolInputSchema,
    },
  }));

  const command = new ConverseStreamCommand({
    modelId: bedrockModelId,
    messages: bedrockMessages,
    ...(systemBlocks.length > 0 ? { system: systemBlocks } : {}),
    ...(bedrockTools.length > 0 ? { toolConfig: { tools: bedrockTools } } : {}),
    inferenceConfig: { maxTokens: 16384 },
  });

  const response = await client.send(command);

  // ── Parse streaming events ──
  let textContent = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let hasToolCalls = false;
  let toolIdx = 0;

  if (response.stream) {
    for await (const chunk of response.stream) {
      if (chunk.contentBlockStart?.start?.toolUse) {
        const tu = chunk.contentBlockStart.start.toolUse;
        hasToolCalls = true;
        toolCalls.set(toolIdx, { id: tu.toolUseId ?? "", name: tu.name ?? "", arguments: "" });
        toolIdx++;
      }

      if (chunk.contentBlockDelta?.delta) {
        const delta = chunk.contentBlockDelta.delta;
        if (delta.text) {
          textContent += delta.text;
          totalTokensOut.value += estimateTokens(delta.text);
          send({ type: "delta", content: delta.text, tokensOut: totalTokensOut.value });
        }
        if (delta.toolUse?.input) {
          const existing = toolCalls.get(toolIdx - 1);
          if (existing) existing.arguments += delta.toolUse.input;
        }
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const reasoning = (delta as any).reasoningContent?.text;
        if (reasoning) send({ type: "thinking_delta", content: reasoning });
      }

      if (chunk.metadata?.usage) {
        const u = chunk.metadata.usage;
        send({
          type: "usage",
          tokensIn: u.inputTokens,
          tokensOut: u.outputTokens,
        });
      }
    }
  }

  if (!textContent && !hasToolCalls) {
    throw new Error("Bedrock returned empty response");
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
  timeoutMs?: number,
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const client = new OpenAI({ apiKey, ...(baseURL ? { baseURL } : {}), timeout: timeoutMs ?? 600_000 });

  // Enable reasoning for models that support it
  const isGPT = nativeModel.startsWith("gpt-");
  const isGrok = nativeModel.startsWith("grok-");

  const response = await client.chat.completions.create({
    model: nativeModel,
    messages: conversation,
    ...(tools.length > 0 ? { tools } : {}),
    max_tokens: 16384,
    stream: true,
    stream_options: { include_usage: true },
    // GPT-5.4 / Grok reasoning
    ...(isGPT || isGrok ? { reasoning_effort: "medium" } : {}),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any);

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

    // DeepSeek/OpenAI reasoning_content
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const reasoning = (choice.delta as any)?.reasoning_content;
    if (reasoning) send({ type: "thinking_delta", content: reasoning });

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

  if (!textContent && !hasToolCalls) {
    throw new Error("Model returned empty response");
  }

  return { textContent, toolCalls, hasToolCalls };
}

/**
 * Stream via Google Gemini API (Tier 2). Uses @google/generative-ai.
 * Supports function calling via Gemini's native tool API.
 */
async function streamGemini(
  nativeModel: string,
  apiKey: string,
  conversation: Message[],
  tools: ToolDef[],
  send: Send,
  estimateTokens: (text: string) => number,
  totalTokensOut: { value: number },
  timeoutMs?: number,
): Promise<{ textContent: string; toolCalls: Map<number, { id: string; name: string; arguments: string }>; hasToolCalls: boolean }> {
  const genAI = new GoogleGenerativeAI(apiKey);

  // Convert tools to Gemini function declarations
  const geminiTools = tools.length > 0 ? [{
    functionDeclarations: tools.map((t) => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters as unknown as FunctionDeclarationSchema,
    })),
  }] : [];

  const model = genAI.getGenerativeModel({
    model: nativeModel,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    generationConfig: { maxOutputTokens: 16384, thinkingConfig: { thinkingBudget: 4096 } } as any,
    ...(geminiTools.length > 0 ? { tools: geminiTools } : {}),
  }, { timeout: timeoutMs ?? 600_000 });

  // Build a map of tool_call_id → function name for converting tool results
  const toolCallIdToName = new Map<string, string>();
  for (const m of conversation) {
    if (m.role === "assistant") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tcs = (m as any).tool_calls as
        | { id: string; function: { name: string; arguments: string } }[]
        | undefined;
      if (tcs) {
        for (const tc of tcs) {
          toolCallIdToName.set(tc.id, tc.function.name);
        }
      }
    }
  }

  // Convert messages to Gemini format (including tool calls & results)
  const systemMsg = conversation.find((m) => m.role === "system");
  const systemText = typeof systemMsg?.content === "string" ? systemMsg.content : "";

  const contents: Content[] = [];
  for (const m of conversation) {
    if (m.role === "system") continue;

    if (m.role === "assistant") {
      const text = typeof m.content === "string" ? m.content : "";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const tcs = (m as any).tool_calls as
        | { id: string; function: { name: string; arguments: string } }[]
        | undefined;

      if (tcs && tcs.length > 0) {
        const parts: Part[] = [];
        if (text) parts.push({ text });
        for (const tc of tcs) {
          let args: object = {};
          try { args = JSON.parse(tc.function.arguments); } catch { /* malformed */ }
          parts.push({ functionCall: { name: tc.function.name, args } });
        }
        contents.push({ role: "model", parts });
      } else if (text) {
        contents.push({ role: "model", parts: [{ text }] });
      }
    } else if (m.role === "tool") {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const toolCallId = (m as any).tool_call_id as string;
      const resultText = typeof m.content === "string" ? m.content : String(m.content ?? "");
      const funcName = toolCallIdToName.get(toolCallId) ?? "unknown";

      const responsePart: Part = {
        functionResponse: { name: funcName, response: { result: resultText } },
      };

      // Merge consecutive tool results into one user turn (Gemini requires this)
      const last = contents[contents.length - 1];
      if (last?.role === "user" && last.parts.some((p) => "functionResponse" in p)) {
        last.parts.push(responsePart);
      } else {
        contents.push({ role: "user", parts: [responsePart] });
      }
    } else {
      // User message — may be multimodal (content array with image_url parts)
      if (Array.isArray(m.content)) {
        const parts: Part[] = [];
        for (const part of m.content) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p = part as any;
          if (p.type === "text") {
            parts.push({ text: p.text });
          } else if (p.type === "image_url") {
            const url: string = p.image_url?.url ?? "";
            const dataMatch = url.match(/^data:([^;]+);base64,(.+)$/);
            if (dataMatch) {
              parts.push({ inlineData: { mimeType: dataMatch[1], data: dataMatch[2] } });
            } else if (url.startsWith("http")) {
              // Gemini SDK only accepts inlineData — fetch URL and convert to base64
              try {
                const imgRes = await fetch(url);
                const buf = Buffer.from(await imgRes.arrayBuffer());
                const mimeType = imgRes.headers.get("content-type") || "image/jpeg";
                parts.push({ inlineData: { mimeType, data: buf.toString("base64") } });
              } catch { /* skip failed image fetches */ }
            }
          }
        }
        if (parts.length > 0) contents.push({ role: "user", parts });
      } else {
        const text = typeof m.content === "string" ? m.content : String(m.content ?? "");
        if (text) {
          contents.push({ role: "user", parts: [{ text }] });
        }
      }
    }
  }

  const result = await model.generateContentStream({
    contents,
    systemInstruction: systemText ? { role: "user", parts: [{ text: systemText }] } : undefined,
  });

  let textContent = "";
  const toolCalls = new Map<number, { id: string; name: string; arguments: string }>();
  let hasToolCalls = false;
  let toolIdx = 0;

  for await (const chunk of result.stream) {

    // Extract thinking parts (thought: true flag)
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const candidates = (chunk as any).candidates;
    if (candidates?.[0]?.content?.parts) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      for (const part of candidates[0].content.parts) {
        if (part.thought === true && part.text) {
          send({ type: "thinking_delta", content: part.text });
        }
      }
    }

    // Extract text (safe — returns "" if no text parts)
    try {
      const text = chunk.text();
      if (text) {
        textContent += text;
        totalTokensOut.value += estimateTokens(text);
        send({ type: "delta", content: text, tokensOut: totalTokensOut.value });
      }
    } catch {
      // chunk.text() can throw if response was blocked; ignore
    }

    // Extract function calls
    const funcCalls = chunk.functionCalls();
    if (funcCalls && funcCalls.length > 0) {
      hasToolCalls = true;
      for (const fc of funcCalls) {
        const id = `gemini_tc_${Date.now()}_${toolIdx}`;
        toolCalls.set(toolIdx, {
          id,
          name: fc.name,
          arguments: JSON.stringify(fc.args),
        });
        toolIdx++;
      }
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

  if (!textContent && !hasToolCalls) {
    throw new Error("Gemini returned empty response");
  }

  return { textContent, toolCalls, hasToolCalls };
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
  timeoutMs?: number,
) {
  switch (provider.sdk) {
    case "anthropic":
      return streamAnthropic(provider.nativeModel, apiKey, conversation, tools, send, estimateTokens, totalTokensOut, timeoutMs);
    case "openai":
      return streamOpenAIDirect(provider.nativeModel, apiKey, conversation, tools, send, estimateTokens, totalTokensOut, provider.baseURL, provider.cacheReadRate, timeoutMs);
    case "gemini":
      return streamGemini(provider.nativeModel, apiKey, conversation, tools, send, estimateTokens, totalTokensOut, timeoutMs);
  }
}

/* ─── Main fallback orchestrator ────────────────────────────────── */

/** Options for streamWithFallback — timeouts, silent mode, exclusions */
export interface StreamOptions {
  /** Per-request timeout in ms (default 600_000). Applied to all SDK clients. */
  timeoutMs?: number;
  /** When true, suppress rerouting events in Tier 4 (e.g. during debate). */
  silent?: boolean;
  /** Models to skip in Tier 4 auto-route (e.g. other debate roster models). */
  excludeModels?: string[];
}

export interface FallbackResult {
  textContent: string;
  toolCalls: Map<number, { id: string; name: string; arguments: string }>;
  hasToolCalls: boolean;
  /** Which model actually served the response */
  actualModel: string;
  /** Which tier succeeded: 1=direct, 2=bedrock, 3=openrouter, 4=auto-route */
  tier: number;
}

/**
 * Attempt to stream a response with multi-tier fallback.
 *
 * Tier 1: Direct API key for the requested model (uses free credits)
 * Tier 2: AWS Bedrock for Claude models (uses AWS credits)
 * Tier 3: OpenRouter with the requested model (fallback)
 * Tier 4: Different model via direct → OpenRouter → Bedrock (sends "rerouting" event)
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
  options?: StreamOptions,
): Promise<FallbackResult> {
  const timeoutMs = options?.timeoutMs;
  const silent = options?.silent ?? false;
  const errors: { tier: number; model: string; error: string }[] = [];

  const directProvider = DIRECT_PROVIDERS[requestedModel];
  const directKey = directProvider ? process.env[directProvider.envKey] : undefined;

  // ── Tier 1: Direct API key (uses free credits on OpenAI/Bedrock/etc.) ──
  if (directProvider && directKey) {
    try {
      console.log("[fallback] tier 1 (direct key):", requestedModel);
      const result = await streamDirect(directProvider, directKey, conversation, tools, send, estimateTokens, totalTokensOut, timeoutMs);
      return { ...result, actualModel: requestedModel, tier: 1 };
    } catch (err) {
      const e = err as Error;
      console.error("[fallback] tier 1 (direct) failed:", requestedModel, e.message, (e as any).status, (e as any).code, JSON.stringify((e as any).error ?? "").slice(0, 500));
      errors.push({ tier: 1, model: requestedModel, error: e.message });
    }
  }

  // ── Tier 2: AWS Bedrock (Claude models only — uses AWS credits) ──
  const bedrockModelId = BEDROCK_MODELS[requestedModel];
  if (bedrockModelId && isBedrockAvailable()) {
    try {
      console.log("[fallback] tier 2 (bedrock, same model):", requestedModel, "→", bedrockModelId);
      const result = await streamBedrock(bedrockModelId, conversation, tools, send, estimateTokens, totalTokensOut);
      return { ...result, actualModel: requestedModel, tier: 2 };
    } catch (err) {
      const e = err as Error;
      console.error("[fallback] tier 2 (bedrock) failed:", requestedModel, e.message);
      errors.push({ tier: 2, model: requestedModel, error: e.message });
    }
  }

  // ── Tier 3: OpenRouter (fallback if direct key and Bedrock both fail) ──
  if (process.env.OPENROUTER_API_KEY) {
    try {
      console.log("[fallback] tier 3 (openrouter):", requestedModel);
      const result = await streamOpenRouter(requestedModel, conversation, tools, send, estimateTokens, totalTokensOut, timeoutMs);
      return { ...result, actualModel: requestedModel, tier: 3 };
    } catch (err) {
      const e = err as Error;
      console.error("[fallback] tier 3 (openrouter) failed:", requestedModel, e.message);
      errors.push({ tier: 3, model: requestedModel, error: e.message });
    }
  }

  // ── Tier 4: Auto-route to a different model ─────────────────────
  // For each candidate, try OpenRouter → direct key → Bedrock (if Claude).
  // GPT 5.4 serves as the final fallback for all models.
  const excluded = options?.excludeModels ?? [];
  const candidates = AUTO_ROUTE_ORDER.filter((m) => m !== requestedModel && !excluded.includes(m));

  for (const candidateModel of candidates) {
    const candidateProvider = DIRECT_PROVIDERS[candidateModel];
    const candidateKey = candidateProvider ? process.env[candidateProvider.envKey] : undefined;

    const providerName = candidateModel.split("/")[0];
    const providerLabel = providerName.charAt(0).toUpperCase() + providerName.slice(1);

    // Try direct key first for this candidate
    if (candidateProvider && candidateKey) {
      try {
        console.log("[fallback] tier 4 (direct, auto-route):", candidateModel);
        if (!silent) send({ type: "rerouting", from: requestedModel, to: candidateModel, provider: providerLabel });
        const result = await streamDirect(candidateProvider, candidateKey, conversation, tools, send, estimateTokens, totalTokensOut, timeoutMs);
        return { ...result, actualModel: candidateModel, tier: 4 };
      } catch (err) {
        const e = err as Error;
        console.error("[fallback] tier 4 direct failed:", candidateModel, e.message);
        errors.push({ tier: 4, model: candidateModel, error: e.message });
      }
    }

    // Then try OpenRouter for this candidate
    if (process.env.OPENROUTER_API_KEY) {
      try {
        console.log("[fallback] tier 4 (openrouter, auto-route):", candidateModel);
        if (!silent) send({ type: "rerouting", from: requestedModel, to: candidateModel, provider: providerLabel });
        const result = await streamOpenRouter(candidateModel, conversation, tools, send, estimateTokens, totalTokensOut, timeoutMs);
        return { ...result, actualModel: candidateModel, tier: 4 };
      } catch (err) {
        const e = err as Error;
        console.error("[fallback] tier 4 openrouter failed:", candidateModel, e.message);
        errors.push({ tier: 4, model: candidateModel, error: e.message });
      }
    }

    // Then try Bedrock for Claude candidates
    const candidateBedrockId = BEDROCK_MODELS[candidateModel];
    if (candidateBedrockId && isBedrockAvailable()) {
      try {
        console.log("[fallback] tier 4 (bedrock, auto-route):", candidateModel, "→", candidateBedrockId);
        if (!silent) send({ type: "rerouting", from: requestedModel, to: candidateModel, provider: providerLabel });
        const result = await streamBedrock(candidateBedrockId, conversation, tools, send, estimateTokens, totalTokensOut);
        return { ...result, actualModel: candidateModel, tier: 4 };
      } catch (err) {
        const e = err as Error;
        console.error("[fallback] tier 4 bedrock failed:", candidateModel, e.message);
        errors.push({ tier: 4, model: candidateModel, error: e.message });
      }
    }
  }

  // All tiers exhausted
  console.error("[fallback] all tiers failed:", JSON.stringify(errors));
  throw new Error("All model providers failed");
}
