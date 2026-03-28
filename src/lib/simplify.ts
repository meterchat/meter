/**
 * Simplifier 1.0 — Occam's Razor engine.
 *
 * Strips unnecessary complexity from whatever the user is discussing.
 * Three passes:
 *
 *   Pass 1 · Assumptions — count and classify every assumption
 *   Pass 2 · Razor — find the core mechanism, cut what's not load-bearing
 *   Pass 3 · Output — the simplified version in 1-3 sentences
 *
 * Reuses the same streaming infrastructure as dissect.ts / debate.ts.
 */

import { streamWithFallback, type Send, type StreamOptions } from "./fallback";
import { META_MODEL, getModel } from "./models";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Hardcoded trigger sent by the slash command */
const SIMPLIFY_TRIGGER = "Simplify this.";

/** Max recent conversation messages to include as context */
const MAX_CONTEXT_MESSAGES = 8;

// ── Persona definitions ────────────────────────────────────────────────

export type SimplifierPersona = "assumptions" | "razor" | "output";

export const SIMPLIFIER_PERSONAS: {
  id: SimplifierPersona;
  label: string;
  color: string;
}[] = [
  { id: "assumptions", label: "Assumptions", color: "#F59E0B" },  // amber
  { id: "razor",       label: "Razor",       color: "#EF4444" },  // red
  { id: "output",      label: "Output",      color: "#10B981" },  // green
];

// ── System prompts per pass ────────────────────────────────────────────

function buildAssumptionsPrompt(topic: string): string {
  return `You are analyzing the assumptions behind this:

"${topic}"

List every assumption this depends on being true. For each one, classify it:
- KNOWN TRUE — verified, evidence exists
- BELIEVED TRUE — reasonable but unverified
- HOPED TRUE — wishful, no evidence

Be exhaustive. Most people have never seen their assumptions listed. The count alone is clarifying.

Rules:
- 1-2 sentences per assumption, no more
- Be specific — not "people want this" but the exact behavioral or structural assumption
- Output a numbered list, each line ending with [KNOWN] [BELIEVED] or [HOPED]
- No preamble, no summary. Just the list.`;
}

function buildRazorPrompt(topic: string, assumptionsOutput: string): string {
  return `You are applying Occam's Razor.

The subject: "${topic}"

Assumptions found:
${assumptionsOutput}

Now cut. Find the single core mechanism — the one causal chain that actually produces the result. Everything outside that chain is a candidate for removal.

Make three cuts:
1. Redundancy — what repeats the same function?
2. Signal — what exists to look thorough rather than produce results?
3. Untested assumptions — what steps only exist because of a [HOPED] or [BELIEVED] assumption?

For each thing you cut, name it and its category in one line.

Rules:
- If complexity is genuinely load-bearing, say so. Don't cut what matters.
- Be surgical. One line per cut.
- No preamble. Just the cuts.`;
}

function buildOutputPrompt(topic: string, assumptionsOutput: string, razorOutput: string): string {
  return `You just ran Occam's Razor on this:

"${topic}"

Assumptions: ${assumptionsOutput}
Cuts made: ${razorOutput}

Now deliver the simplified version. This is what the user actually came for.

Rules:
- 1-3 sentences maximum. Extreme clarity.
- This is the rebuilt-from-scratch version — the minimum that achieves the goal.
- Do NOT explain your process. Do NOT list what you cut. Just deliver the simple version.
- End with one line: "The complexity came from [name the specific temptation — fear of being wrong, accumulated process, framework addiction, etc.]."
- Write like someone who has seen this pattern ten thousand times. Precise. Slightly impatient with the complexity, not with the person.`;
}

// ── Context extraction ─────────────────────────────────────────────────

function extractSimplifierContext(conversation: Message[]): {
  topic: string;
  context: Message[];
} {
  const nonSystem = conversation.filter((m) => m.role !== "system");
  const userMessages = nonSystem.filter((m) => m.role === "user");

  const lastUserContent =
    typeof userMessages[userMessages.length - 1]?.content === "string"
      ? (userMessages[userMessages.length - 1].content as string).trim()
      : "";

  const isSimplifyTrigger = lastUserContent === SIMPLIFY_TRIGGER;

  const realQuestion =
    isSimplifyTrigger && userMessages.length >= 2
      ? userMessages[userMessages.length - 2]
      : userMessages[userMessages.length - 1];
  const topic =
    typeof realQuestion?.content === "string"
      ? realQuestion.content
      : "the topic under discussion";

  const withoutTrigger = isSimplifyTrigger ? nonSystem.slice(0, -1) : nonSystem;
  const trimmed = withoutTrigger.slice(-MAX_CONTEXT_MESSAGES);

  return { topic, context: trimmed };
}

// ── Usage accumulator ──────────────────────────────────────────────────

interface SimplifyUsage {
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  actualCost: number;
}

// ── Single pass runner ─────────────────────────────────────────────────

async function runPass(
  persona: SimplifierPersona,
  messages: Message[],
  send: Send,
  usage: SimplifyUsage,
): Promise<string> {
  const model = getModel(META_MODEL);

  send({ type: "simplifier_turn_start", persona });

  let content = "";
  let roundIn = 0;
  let roundOut = 0;
  let roundCacheCreation = 0;
  let roundCacheRead = 0;
  let roundCacheReadRate = 0;

  const passSend: Send = (data) => {
    if (data.type === "delta") {
      content += data.content as string;
      send({ type: "simplifier_turn_delta", content: data.content, persona });
    }
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
      roundCacheCreation = (data.cacheCreationTokens as number) || 0;
      roundCacheRead = (data.cacheReadTokens as number) || 0;
      roundCacheReadRate = (data.cacheReadRate as number) || 0;
    }
  };

  const totalOut = { value: 0 };
  try {
    await streamWithFallback(META_MODEL, messages, [], passSend, estimateTokens, totalOut, { timeoutMs: 180_000, silent: true });
  } catch {
    content = "(This pass encountered an error.)";
  }

  usage.tokensIn += roundIn;
  usage.tokensOut += roundOut;
  usage.cacheCreationTokens += roundCacheCreation;
  usage.cacheReadTokens += roundCacheRead;

  const uncachedIn = roundIn - roundCacheCreation - roundCacheRead;
  const inputCost = (roundCacheCreation > 0 || roundCacheRead > 0)
    ? (uncachedIn * model.inputPrice) +
      (roundCacheCreation * model.inputPrice * 1.25) +
      (roundCacheRead * model.inputPrice * (roundCacheReadRate || 0.1))
    : roundIn * model.inputPrice;
  usage.actualCost += inputCost + roundOut * model.outputPrice;

  send({ type: "simplifier_turn_end", persona });

  return content;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function runSimplification(
  conversation: Message[],
  send: Send,
) {
  const usage: SimplifyUsage = { tokensIn: 0, tokensOut: 0, cacheCreationTokens: 0, cacheReadTokens: 0, actualCost: 0 };
  const { topic, context } = extractSimplifierContext(conversation);
  const model = getModel(META_MODEL);

  send({ type: "simplifier_start" });

  // ── Pass 1: Assumptions ──────────────────────────────────────────

  const assumptionsMessages: Message[] = [
    { role: "system", content: buildAssumptionsPrompt(topic) },
    ...context,
  ];

  const assumptionsOutput = await runPass("assumptions", assumptionsMessages, send, usage);

  // ── Pass 2: Razor ────────────────────────────────────────────────

  const razorMessages: Message[] = [
    { role: "system", content: buildRazorPrompt(topic, assumptionsOutput) },
    ...context,
  ];

  const razorOutput = await runPass("razor", razorMessages, send, usage);

  // ── Pass 3: Output (streams into the message bubble) ─────────────

  send({ type: "simplifier_synthesis_start" });

  const outputMessages: Message[] = [
    { role: "system", content: buildOutputPrompt(topic, assumptionsOutput, razorOutput) },
    { role: "user", content: topic },
  ];

  let roundIn = 0;
  let roundOut = 0;
  let roundCacheCreation = 0;
  let roundCacheRead = 0;
  let roundCacheReadRate = 0;

  const outputSend: Send = (data) => {
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
      roundCacheCreation = (data.cacheCreationTokens as number) || 0;
      roundCacheRead = (data.cacheReadTokens as number) || 0;
      roundCacheReadRate = (data.cacheReadRate as number) || 0;
      return;
    }
    // Forward deltas — output streams into the message bubble
    send(data);
  };

  const totalOut = { value: 0 };
  await streamWithFallback(
    META_MODEL,
    outputMessages,
    [],
    outputSend,
    estimateTokens,
    totalOut,
    { timeoutMs: 180_000, silent: true },
  );

  usage.tokensIn += roundIn;
  usage.tokensOut += roundOut;
  usage.cacheCreationTokens += roundCacheCreation;
  usage.cacheReadTokens += roundCacheRead;

  const outputUncachedIn = roundIn - roundCacheCreation - roundCacheRead;
  const outputInputCost = (roundCacheCreation > 0 || roundCacheRead > 0)
    ? (outputUncachedIn * model.inputPrice) +
      (roundCacheCreation * model.inputPrice * 1.25) +
      (roundCacheRead * model.inputPrice * (roundCacheReadRate || 0.1))
    : roundIn * model.inputPrice;
  usage.actualCost += outputInputCost + roundOut * model.outputPrice;

  // ── Done ──────────────────────────────────────────────────────────

  send({
    type: "usage",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    cacheCreationTokens: usage.cacheCreationTokens,
    cacheReadTokens: usage.cacheReadTokens,
    actualCost: usage.actualCost,
  });
  send({ type: "done", actualModel: "simplify" });
}
