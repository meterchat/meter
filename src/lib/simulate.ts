/**
 * Simulator 1.0 — multi-pass analytical engine.
 *
 * Runs three sequential passes through a single model (Opus), each
 * adopting a distinct persona that cross-references previous passes:
 *
 *   Pass 1 · Optimist — bullish framing, tailwinds, upside potential
 *   Pass 2 · Pessimist — targeted rebuttal of Optimist's specific claims
 *   Pass 3 · Realist — adjudicates both, assigns weight, identifies gaps
 *
 * Then a final Conviction Score (1-10) with one sentence of reasoning.
 *
 * Design mirrors debate.ts:
 *   - Sequential streaming passes with distinct visual identity
 *   - Cross-referencing creates intellectual tension
 *   - One sharp clarifying question before analysis (optional)
 *   - Conviction score as actionable conclusion
 */

import { streamWithFallback, type Send } from "./fallback";
import { SIMULATOR_MODEL, getModel } from "./models";
import { executeTool } from "./tools";
import type { ToolDef } from "./tools";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

interface ToolContext {
  userId?: string;
  projectId?: string;
  workspaceId?: string;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Hardcoded trigger sent by the Simulate button in the UI */
const SIMULATE_TRIGGER = "Simulate this.";

/** Max recent conversation messages to include as context */
const MAX_CONTEXT_MESSAGES = 6;

const MAX_TOOL_ROUNDS = 3;

// ── Persona definitions ────────────────────────────────────────────────

export type SimulatorPersona = "optimist" | "pessimist" | "realist";

export const SIMULATOR_PERSONAS: {
  id: SimulatorPersona;
  label: string;
  color: string;
}[] = [
  { id: "optimist", label: "Optimist", color: "#22C55E" },   // green
  { id: "pessimist", label: "Pessimist", color: "#EF4444" },  // red
  { id: "realist", label: "Realist", color: "#8B5CF6" },      // purple
];

// ── System prompts per pass ────────────────────────────────────────────

function buildOptimistPrompt(topic: string): string {
  return `You are the Optimist in a structured simulation of the following idea:

"${topic}"

Your job: make the strongest possible bull case. Be specific, not generic.

Write 3-5 sentences of dense, confident analysis. Cover:
- What does wild success look like? How big could this get?
- What tailwinds exist? What has to go right?
- What specific advantages or timing factors favor this?

Rules:
- Use specific numbers, timeframes, and comparisons
- No hedging — you are the bull case, own it fully
- No bullet points or lists — write in direct prose
- Do NOT mention that you are the optimist or reference the simulation format`;
}

function buildPessimistPrompt(topic: string, optimistOutput: string): string {
  return `You are the Pessimist in a structured simulation. The Optimist just made this case:

"${optimistOutput}"

About the idea: "${topic}"

Your job: directly challenge the Optimist's specific claims. Not generic pessimism — targeted rebuttal.

Write 3-5 sentences of dense, honest analysis. You MUST:
- Reference and attack specific claims the Optimist made (quote or paraphrase them)
- Explain the most likely way this fails
- Identify the critical assumption that breaks first

Rules:
- Use specific numbers, timeframes, and failure modes
- No hedging — you are the bear case, own it fully
- No bullet points or lists — write in direct prose
- Do NOT mention that you are the pessimist or reference the simulation format`;
}

function buildRealistPrompt(
  topic: string,
  optimistOutput: string,
  pessimistOutput: string,
): string {
  return `You are the Realist in a structured simulation. Two perspectives have been given:

Optimist's case: "${optimistOutput}"

Pessimist's case: "${pessimistOutput}"

About the idea: "${topic}"

Your job: adjudicate. Do NOT summarize or split the difference. Pick specific points from each side and assign weight.

Write 3-5 sentences of dense analysis. You MUST:
- Say specifically where the Optimist is right and where they're wrong
- Say specifically where the Pessimist is right and where they're wrong
- Identify the one thing NEITHER of them addressed that actually matters most

Rules:
- Use specific numbers, timeframes, and probabilities
- No both-sidesing — take positions on each claim
- No bullet points or lists — write in direct prose
- Do NOT mention that you are the realist or reference the simulation format`;
}

function buildConvictionPrompt(
  topic: string,
  optimistOutput: string,
  pessimistOutput: string,
  realistOutput: string,
): string {
  return `You just ran a three-pass simulation on this idea:

"${topic}"

Optimist: "${optimistOutput}"
Pessimist: "${pessimistOutput}"
Realist: "${realistOutput}"

Give a conviction score and save the full simulation as a document.

Output EXACTLY this format (nothing else before the score):

**Conviction: X/10** — [one sentence explaining what this score means for the idea]

Calibration: most ideas land 3-7. An 8+ means you'd bet real money. A 2 or below means almost certainly dead.

Then call the save_artifact tool to save the complete simulation as a strategy document. Format the document with all three perspectives clearly labeled, followed by the conviction score.`;
}

// ── Clarifying question tool ───────────────────────────────────────────

const ASK_CLARIFYING_QUESTION_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "ask_clarifying_questions",
    description:
      "Ask the user ONE sharp clarifying question before running analysis. Use when the idea is missing a critical detail that would change the analysis.",
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

const CLARIFY_SYSTEM_PROMPT = `You are Simulator 1.0 by Meter. The user wants you to analyze an idea.

Before running your analysis, decide: is there ONE critical piece of context missing that would significantly change the analysis? If so, call the ask_clarifying_questions tool with exactly one short, sharp question.

If the idea is already specific enough, do NOT ask a question — just respond with "Ready to analyze." and nothing else.

The question should reveal the most critical assumption. Examples:
- "Is your target customer paying for this themselves or is it a company budget?"
- "Are you building this as a solo founder or do you have a technical cofounder?"
- "Is this a new market or are you displacing an incumbent?"

Do NOT ask generic questions. Ask the one question that matters most.`;

// ── Context extraction ─────────────────────────────────────────────────

function extractSimulatorContext(conversation: Message[]): {
  topic: string;
  context: Message[];
} {
  const nonSystem = conversation.filter((m) => m.role !== "system");
  const userMessages = nonSystem.filter((m) => m.role === "user");

  const lastUserContent =
    typeof userMessages[userMessages.length - 1]?.content === "string"
      ? (userMessages[userMessages.length - 1].content as string).trim()
      : "";

  const isSimulateTrigger = lastUserContent === SIMULATE_TRIGGER;

  const realQuestion =
    isSimulateTrigger && userMessages.length >= 2
      ? userMessages[userMessages.length - 2]
      : userMessages[userMessages.length - 1];
  const topic =
    typeof realQuestion?.content === "string"
      ? realQuestion.content
      : "the topic under discussion";

  const withoutTrigger = isSimulateTrigger ? nonSystem.slice(0, -1) : nonSystem;
  const trimmed = withoutTrigger.slice(-MAX_CONTEXT_MESSAGES);

  return { topic, context: trimmed };
}

// ── Usage accumulator ──────────────────────────────────────────────────

interface SimulationUsage {
  tokensIn: number;
  tokensOut: number;
  actualCost: number;
}

// ── Single pass runner ─────────────────────────────────────────────────

async function runPass(
  persona: SimulatorPersona,
  messages: Message[],
  send: Send,
  usage: SimulationUsage,
): Promise<string> {
  const model = getModel(SIMULATOR_MODEL);

  send({ type: "simulator_turn_start", persona });

  let content = "";
  let roundIn = 0;
  let roundOut = 0;

  const passSend: Send = (data) => {
    if (data.type === "delta") {
      content += data.content as string;
      send({ type: "simulator_turn_delta", content: data.content, persona });
    }
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
    }
  };

  const totalOut = { value: 0 };
  try {
    await streamWithFallback(SIMULATOR_MODEL, messages, [], passSend, estimateTokens, totalOut);
  } catch {
    content = "(This pass encountered an error.)";
  }

  usage.tokensIn += roundIn;
  usage.tokensOut += roundOut;
  usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

  send({ type: "simulator_turn_end", persona });

  return content;
}

// ── Main entry point ───────────────────────────────────────────────────

export async function runSimulation(
  conversation: Message[],
  send: Send,
  tools: ToolDef[],
  toolContext: ToolContext,
) {
  const usage: SimulationUsage = { tokensIn: 0, tokensOut: 0, actualCost: 0 };
  const { topic, context } = extractSimulatorContext(conversation);
  const model = getModel(SIMULATOR_MODEL);

  send({ type: "simulator_start" });

  // ── Check if this is the first turn (might need a clarifying question) ──
  const hasSimulatorHistory = context.some(
    (m) => m.role === "assistant" && context.indexOf(m) > 0,
  );

  if (!hasSimulatorHistory) {
    // First turn — ask one clarifying question or proceed
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
      SIMULATOR_MODEL,
      clarifyMessages,
      [ASK_CLARIFYING_QUESTION_TOOL],
      clarifySend,
      estimateTokens,
      totalOut,
    );

    usage.tokensIn += roundIn;
    usage.tokensOut += roundOut;
    usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

    // Check if the model asked a question
    if (result.hasToolCalls && result.toolCalls.size > 0) {
      for (const tc of result.toolCalls.values()) {
        if (tc.name === "ask_clarifying_questions") {
          let args: Record<string, unknown> = {};
          try { args = JSON.parse(tc.arguments); } catch { /* */ }
          const questions = (args.questions as string[]) || [];
          send({ type: "simulator_questions", questions });

          // Stop — wait for user to answer
          send({
            type: "usage",
            tokensIn: usage.tokensIn,
            tokensOut: usage.tokensOut,
            actualCost: usage.actualCost,
          });
          send({ type: "done", actualModel: "simulator-1.0" });
          return;
        }
      }
    }

    // Model didn't ask a question — fall through to run the passes
  }

  // ── Pass 1: Optimist ──────────────────────────────────────────────────

  const optimistMessages: Message[] = [
    { role: "system", content: buildOptimistPrompt(topic) },
    ...context,
  ];

  const optimistOutput = await runPass("optimist", optimistMessages, send, usage);

  // ── Pass 2: Pessimist (cross-references Optimist) ─────────────────────

  const pessimistMessages: Message[] = [
    { role: "system", content: buildPessimistPrompt(topic, optimistOutput) },
    ...context,
  ];

  const pessimistOutput = await runPass("pessimist", pessimistMessages, send, usage);

  // ── Pass 3: Realist (adjudicates both) ────────────────────────────────

  const realistMessages: Message[] = [
    {
      role: "system",
      content: buildRealistPrompt(topic, optimistOutput, pessimistOutput),
    },
    ...context,
  ];

  const realistOutput = await runPass("realist", realistMessages, send, usage);

  // ── Conviction Score + save artifact ──────────────────────────────────

  send({ type: "simulator_synthesis_start" });

  const convictionMessages: Message[] = [
    {
      role: "system",
      content: buildConvictionPrompt(topic, optimistOutput, pessimistOutput, realistOutput),
    },
    { role: "user", content: topic },
  ];

  // Run conviction with save_artifact tool so it auto-saves
  const convictionTools = tools.filter(
    (t) => t.function.name === "save_artifact",
  );

  let roundIn = 0;
  let roundOut = 0;

  const convictionSend: Send = (data) => {
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
      return;
    }
    // Forward deltas as standard deltas (streams into the message bubble)
    send(data);
  };

  const totalOut = { value: 0 };

  // Tool loop for conviction (handles save_artifact)
  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    roundIn = 0;
    roundOut = 0;

    const result = await streamWithFallback(
      SIMULATOR_MODEL,
      convictionMessages,
      convictionTools,
      convictionSend,
      estimateTokens,
      totalOut,
    );

    usage.tokensIn += roundIn;
    usage.tokensOut += roundOut;
    usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

    if (!result.hasToolCalls || result.toolCalls.size === 0) break;

    // Add assistant message with tool calls
    convictionMessages.push({
      role: "assistant",
      content: result.textContent || null,
      tool_calls: Array.from(result.toolCalls.values()).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    for (const tc of result.toolCalls.values()) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.arguments); } catch { /* */ }

      send({ type: "tool_call", name: tc.name });
      const toolResult = await executeTool(tc.name, args, toolContext);

      const toolResultEvent: Record<string, unknown> = {
        type: "tool_result",
        name: tc.name,
      };
      if (tc.name === "save_artifact") {
        let artifactData: { id?: string; content?: string; category?: string } | undefined;
        try { artifactData = JSON.parse(toolResult); } catch { /* */ }
        toolResultEvent.artifact = {
          id: artifactData?.id,
          filePath: args.file_path,
          content: args.content,
          category: artifactData?.category || args.category || "other",
          status: "draft",
        };
      }
      send(toolResultEvent);

      convictionMessages.push({
        role: "tool",
        tool_call_id: tc.id,
        content: toolResult,
      });
    }
  }

  // ── Done ──────────────────────────────────────────────────────────────

  send({
    type: "usage",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    actualCost: usage.actualCost,
  });
  send({ type: "done", actualModel: "simulator-1.0" });
}
