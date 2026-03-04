/**
 * Dissector 1.0 — structured idea dissection engine.
 *
 * Opens up an idea and shows what's inside through four analytical layers:
 *
 *   Pass 1 · First Principles — strip all assumptions, surface what must be true
 *   Pass 2 · Inversion (Munger) — what guarantees failure? avoid those things
 *   Pass 3 · Pre-mortem — it's one year later and this failed. why?
 *   Pass 4 · Verdict — honest assessment + summary table
 *
 * Design mirrors simulate.ts / debate.ts:
 *   - Sequential streaming passes with distinct visual identity
 *   - Each pass builds on previous output for cross-referencing
 *   - One sharp clarifying question before dissection (optional)
 *   - Summary table at the end as actionable output
 */

import { streamWithFallback, type Send, type StreamOptions } from "./fallback";
import { META_MODEL, getModel } from "./models";
import type { ToolDef } from "./tools";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Hardcoded trigger sent by the Dissect button in the UI */
const DISSECT_TRIGGER = "Dissect this.";

/** Max recent conversation messages to include as context */
const MAX_CONTEXT_MESSAGES = 6;

// ── Persona definitions ────────────────────────────────────────────────

export type DissectorPersona = "first-principles" | "inversion" | "pre-mortem" | "verdict";

export const DISSECTOR_PERSONAS: {
  id: DissectorPersona;
  label: string;
  color: string;
}[] = [
  { id: "first-principles", label: "First Principles", color: "#3B82F6" },  // blue
  { id: "inversion", label: "Inversion", color: "#F59E0B" },               // amber
  { id: "pre-mortem", label: "Pre-mortem", color: "#EF4444" },             // red
  { id: "verdict", label: "Verdict", color: "#8B5CF6" },                   // purple
];

// ── System prompts per pass ────────────────────────────────────────────

function buildFirstPrinciplesPrompt(topic: string): string {
  return `You are performing a First Principles dissection of the following idea:

"${topic}"

Strip away every assumption. Do not evaluate whether this is good or bad yet. Just answer:

- What is this idea actually, at its core? One sentence.
- What must be true for this to work? List the 3-4 non-obvious assumptions that must hold. Not "people need to want it" — dig deeper. What specific behaviors, market conditions, or technical realities are being assumed?
- Which of these assumptions is the most fragile? The one most likely to be wrong?

Rules:
- Be surgical, not conversational
- Each assumption should be something the founder might not have explicitly considered
- Write in direct prose, 3-5 sentences total
- Do NOT reference the dissection format or label yourself`;
}

function buildInversionPrompt(topic: string, firstPrinciplesOutput: string): string {
  return `You are performing an Inversion analysis (Charlie Munger style).

The idea: "${topic}"

First Principles analysis found these assumptions: "${firstPrinciplesOutput}"

Flip it completely. Instead of asking how this succeeds, answer: what guarantees failure?

List the three fastest ways to kill this idea. Be specific — not "bad execution" but the exact mistake, behavior, or market condition that makes this impossible. For each, explain why it's likely (not just possible).

Then: which of these failure modes is the founder most likely to walk into without realizing it?

Rules:
- Be specific and concrete — names, numbers, timeframes
- Each failure mode should be actionable (the reader can check if they're heading toward it)
- Write in direct prose, 3-5 sentences total
- Do NOT reference the dissection format or label yourself`;
}

function buildPreMortemPrompt(
  topic: string,
  firstPrinciplesOutput: string,
  inversionOutput: string,
): string {
  return `You are performing a Pre-mortem analysis.

The idea: "${topic}"

First Principles found: "${firstPrinciplesOutput}"
Inversion found: "${inversionOutput}"

It is one year from now. This idea failed. Not might fail — it failed. The company shut down or pivoted away.

Write the post-mortem. Be brutally specific. Not "the market was too small" but the exact sequence of events: what happened in months 1-3, what went wrong at month 6, and what finally killed it by month 12. Reference the specific assumptions and failure modes identified above.

End with: the one decision point where this could have been saved, and what the founder should have done differently.

Rules:
- Write as a narrative, not a list — tell the story of the failure
- Use specific timeframes and concrete events
- 4-6 sentences total
- Do NOT reference the dissection format or label yourself`;
}

function buildVerdictPrompt(
  topic: string,
  firstPrinciplesOutput: string,
  inversionOutput: string,
  preMortemOutput: string,
): string {
  return `You just ran a four-layer dissection of this idea:

"${topic}"

First Principles: "${firstPrinciplesOutput}"
Inversion: "${inversionOutput}"
Pre-mortem: "${preMortemOutput}"

Output EXACTLY this structure, in this order:

1. The summary table FIRST (use the actual findings, not placeholders):

| Dimension | Finding |
|---|---|
| Core Assumption | [the most fragile assumption from First Principles] |
| Biggest Risk | [the most likely failure mode from Inversion] |
| Inversion | [the fastest path to death] |
| Pre-mortem | [the specific reason it failed in the narrative] |
| Verdict | [one-sentence honest assessment] |

2. Then a horizontal rule: ---

3. Then ONE closing paragraph — the honest verdict. No hedging, no preamble. 2-4 sentences that synthesize everything above into a clear recommendation. End the paragraph with **Conviction: X/10** inline.

Calibration: most ideas land 3-7. An 8+ means you'd bet real money. A 2 or below means almost certainly dead.

Rules:
- Table findings must be specific and self-explanatory — no vague labels like "High Risk", state the actual finding
- The closing paragraph should feel like a sharp advisor giving you the truth, not a report summary
- Do NOT output any text before the table — the table is the first thing the user sees
- Do NOT reference the dissection format or label sections`;
}

// ── Clarifying question tool ───────────────────────────────────────────

const ASK_CLARIFYING_QUESTION_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "ask_clarifying_questions",
    description:
      "Ask the user ONE sharp clarifying question before running the dissection. Use when the idea is missing a critical detail.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: { type: "string" },
          maxItems: 1,
          description: "Exactly one critical clarifying question",
        },
      },
      required: ["questions"],
    },
  },
};

const CLARIFY_SYSTEM_PROMPT = `You are Dissector 1.0 by Meter. The user wants you to dissect an idea.

Before running your dissection, decide: is there ONE critical piece of context missing that would significantly change the analysis? If so, call the ask_clarifying_questions tool with exactly one short, sharp question.

If the idea is already specific enough, do NOT ask a question — just respond with "Ready to dissect." and nothing else.

The question should reveal the most critical hidden assumption. Examples:
- "Have you validated that these customers actually pay for this today, or is that an assumption?"
- "Is there an existing budget line item this replaces, or does the buyer need to create a new one?"
- "What happens to your unit economics if the underlying API costs double?"

Do NOT ask generic questions. Ask the one question that cuts deepest.`;

// ── Context extraction ─────────────────────────────────────────────────

function extractDissectorContext(conversation: Message[]): {
  topic: string;
  context: Message[];
} {
  const nonSystem = conversation.filter((m) => m.role !== "system");
  const userMessages = nonSystem.filter((m) => m.role === "user");

  const lastUserContent =
    typeof userMessages[userMessages.length - 1]?.content === "string"
      ? (userMessages[userMessages.length - 1].content as string).trim()
      : "";

  const isDissectTrigger = lastUserContent === DISSECT_TRIGGER;

  const realQuestion =
    isDissectTrigger && userMessages.length >= 2
      ? userMessages[userMessages.length - 2]
      : userMessages[userMessages.length - 1];
  const topic =
    typeof realQuestion?.content === "string"
      ? realQuestion.content
      : "the topic under discussion";

  const withoutTrigger = isDissectTrigger ? nonSystem.slice(0, -1) : nonSystem;
  const trimmed = withoutTrigger.slice(-MAX_CONTEXT_MESSAGES);

  return { topic, context: trimmed };
}

// ── Usage accumulator ──────────────────────────────────────────────────

interface DissectionUsage {
  tokensIn: number;
  tokensOut: number;
  actualCost: number;
}

// ── Single pass runner ─────────────────────────────────────────────────

async function runPass(
  persona: DissectorPersona,
  messages: Message[],
  send: Send,
  usage: DissectionUsage,
): Promise<string> {
  const model = getModel(META_MODEL);

  send({ type: "dissector_turn_start", persona });

  let content = "";
  let roundIn = 0;
  let roundOut = 0;

  const passSend: Send = (data) => {
    if (data.type === "delta") {
      content += data.content as string;
      send({ type: "dissector_turn_delta", content: data.content, persona });
    }
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
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
  usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

  send({ type: "dissector_turn_end", persona });

  return content;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function runDissection(
  conversation: Message[],
  send: Send,
) {
  const usage: DissectionUsage = { tokensIn: 0, tokensOut: 0, actualCost: 0 };
  const { topic, context } = extractDissectorContext(conversation);
  const model = getModel(META_MODEL);

  send({ type: "dissector_start" });

  // ── Check if this is the first turn (might need a clarifying question) ──
  const hasDissectorHistory = context.some(
    (m) => m.role === "assistant" && context.indexOf(m) > 0,
  );

  if (!hasDissectorHistory) {
    const clarifyMessages: Message[] = [
      { role: "system", content: CLARIFY_SYSTEM_PROMPT },
      ...context,
    ];

    let roundIn = 0;
    let roundOut = 0;
    let textContent = "";

    const clarifySend: Send = (data) => {
      if (data.type === "usage") {
        roundIn = (data.tokensIn as number) || 0;
        roundOut = (data.tokensOut as number) || 0;
      }
      if (data.type === "delta") {
        textContent += data.content as string;
      }
    };

    const totalOut = { value: 0 };
    const result = await streamWithFallback(
      META_MODEL,
      clarifyMessages,
      [ASK_CLARIFYING_QUESTION_TOOL],
      clarifySend,
      estimateTokens,
      totalOut,
      { timeoutMs: 180_000, silent: true },
    );

    usage.tokensIn += roundIn;
    usage.tokensOut += roundOut;
    usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

    if (result.hasToolCalls && result.toolCalls.size > 0) {
      for (const tc of result.toolCalls.values()) {
        if (tc.name === "ask_clarifying_questions") {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.arguments); } catch { /* */ }
          const questions = (args.questions as string[]) || [];
          send({ type: "dissector_questions", questions });

          send({
            type: "usage",
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            actualCost: usage.actualCost,
          });
          send({ type: "done", actualModel: "dissect" });
          return;
        }
      }
    }
  }

  // ── Pass 1: First Principles ────────────────────────────────────────

  const fpMessages: Message[] = [
    { role: "system", content: buildFirstPrinciplesPrompt(topic) },
    ...context,
  ];

  const fpOutput = await runPass("first-principles", fpMessages, send, usage);

  // ── Pass 2: Inversion (cross-references First Principles) ───────────

  const invMessages: Message[] = [
    { role: "system", content: buildInversionPrompt(topic, fpOutput) },
    ...context,
  ];

  const invOutput = await runPass("inversion", invMessages, send, usage);

  // ── Pass 3: Pre-mortem (cross-references both) ──────────────────────

  const pmMessages: Message[] = [
    {
      role: "system",
      content: buildPreMortemPrompt(topic, fpOutput, invOutput),
    },
    ...context,
  ];

  const pmOutput = await runPass("pre-mortem", pmMessages, send, usage);

  // ── Pass 4: Verdict + Table ─────────────────────────────────────────

  send({ type: "dissector_synthesis_start" });

  const verdictMessages: Message[] = [
    {
      role: "system",
      content: buildVerdictPrompt(topic, fpOutput, invOutput, pmOutput),
    },
    { role: "user", content: topic },
  ];

  let roundIn = 0;
  let roundOut = 0;

  const verdictSend: Send = (data) => {
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
      return;
    }
    // Forward deltas — verdict + table stream into the message bubble
    send(data);
  };

  const totalOut = { value: 0 };
  await streamWithFallback(
    META_MODEL,
    verdictMessages,
    [],
    verdictSend,
    estimateTokens,
    totalOut,
    { timeoutMs: 180_000, silent: true },
  );

  usage.tokensIn += roundIn;
  usage.tokensOut += roundOut;
  usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

  // ── Done ──────────────────────────────────────────────────────────────

  send({
    type: "usage",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    actualCost: usage.actualCost,
  });
  send({ type: "done", actualModel: "dissect" });
}
