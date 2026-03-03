/**
 * Simulator 1.0 — structured analytical engine.
 *
 * Evaluates ideas, decisions, and plans through six lenses:
 *   1. First Principles
 *   2. Optimistic Case
 *   3. Pessimistic Case
 *   4. Realistic Case
 *   5. Inversion (Munger)
 *   6. Prediction
 *
 * Design:
 *   - Single Opus call per turn (no multi-model orchestration)
 *   - First turn: model may call `ask_clarifying_questions` tool
 *     → engine intercepts and emits `simulator_questions` event
 *     → UI renders inline Q&A card (no separate message bubbles)
 *   - Follow-up turn: model runs full analysis with standard tools
 *   - Follows the same short-circuit pattern as debate.ts
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

const MAX_TOOL_ROUNDS = 5;

const SIMULATOR_SYSTEM_PROMPT = `You are Simulator 1.0 by Meter — a structured analytical engine that evaluates ideas, decisions, and plans through multiple lenses.

BEHAVIOR:
When the user presents an idea, decision, or plan for the FIRST TIME:
- If you need more context, call the ask_clarifying_questions tool with up to 3 short, specific questions. Focus on: market, timeline, resources, constraints. Only ask questions that would meaningfully change your analysis.
- If the idea is already specific enough, skip questions and go straight to analysis.

When you have enough context (either from the initial message or after receiving answers to your questions):
Run through each analytical lens in order:

1. First Principles — Break the idea to its core assumptions. Are they sound? What is this really betting on?
2. Optimistic Case — What does wild success look like? How big could this get? What has to go right?
3. Pessimistic Case — What does failure look like? Most likely way this dies? What kills it fastest?
4. Realistic Case — Most probable outcome. Honest likelihood of success. No hedging.
5. Inversion (Munger) — Flip it: what guarantees failure? List those things. This is the most valuable section — treat it seriously.
6. Prediction — What likely happens at 3 months, 6 months, 12 months? Be specific. No vague "it depends."

OUTPUT FORMAT:
Start with this summary table:

| Lens | Assessment | Confidence |
|------|-----------|------------|
| First Principles | Sound / Flawed / Mixed | High / Medium / Low |
| Optimistic Case | [one-line summary] | — |
| Pessimistic Case | [one-line summary] | — |
| Realistic Case | [one-line summary] | — |
| Inversion | [top risk to avoid] | — |
| Prediction (12mo) | [most likely outcome] | High / Medium / Low |

Then write short, dense paragraphs — 400-600 words total. Each section gets 2-3 sentences max.

End with: **Conviction: X/10** — how confident you are this succeeds as described. Calibrate honestly: most ideas land 3-7. An 8+ means you'd bet real money. A 2 or below means almost certainly dead.

After writing the analysis, save it as a document using the save_artifact tool with a descriptive filename like "[topic]-simulation.md" and category "strategy".

RULES:
- Be brutally honest, not encouraging
- Use specific numbers and timeframes, never vague qualifiers
- Never say "it depends" without immediately saying what it depends on and which way it likely breaks
- The Inversion section is the most valuable — give it real thought
- Keep the Conviction Score calibrated (most ideas should be 3-7, not 8-10)`;

/** Tool that lets the model ask clarifying questions (intercepted by engine, not executed) */
const ASK_CLARIFYING_QUESTIONS_TOOL: ToolDef = {
  type: "function",
  function: {
    name: "ask_clarifying_questions",
    description:
      "Ask the user clarifying questions before running analysis. Use when you need more context about the idea, decision, or plan.",
    parameters: {
      type: "object",
      properties: {
        questions: {
          type: "array",
          items: { type: "string" },
          maxItems: 3,
          description: "Up to 3 short, specific clarifying questions",
        },
      },
      required: ["questions"],
    },
  },
};

/**
 * Extract topic from conversation — if the last user message is the
 * "Simulate this." trigger, look at the prior assistant message.
 */
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

  // Keep recent messages as context (drop trigger if present)
  const withoutTrigger = isSimulateTrigger ? nonSystem.slice(0, -1) : nonSystem;
  const trimmed = withoutTrigger.slice(-6);

  return { topic, context: trimmed };
}

interface SimulationUsage {
  tokensIn: number;
  tokensOut: number;
  actualCost: number;
}

export async function runSimulation(
  conversation: Message[],
  send: Send,
  tools: ToolDef[],
  toolContext: ToolContext,
) {
  const usage: SimulationUsage = { tokensIn: 0, tokensOut: 0, actualCost: 0 };
  const { context } = extractSimulatorContext(conversation);
  const model = getModel(SIMULATOR_MODEL);

  send({ type: "simulator_start" });

  // Build messages with simulator system prompt
  const messages: Message[] = [
    { role: "system", content: SIMULATOR_SYSTEM_PROMPT },
    ...context,
  ];

  // Include the clarifying questions tool alongside standard tools
  const allTools: ToolDef[] = [ASK_CLARIFYING_QUESTIONS_TOOL, ...tools];

  const totalOut = { value: 0 };

  // Intercept usage events to accumulate cost
  let roundIn = 0;
  let roundOut = 0;

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
    roundIn = 0;
    roundOut = 0;

    const roundSend: Send = (data) => {
      if (data.type === "usage") {
        roundIn = (data.tokensIn as number) || 0;
        roundOut = (data.tokensOut as number) || 0;
        return;
      }
      // Forward deltas and other events to client
      send(data);
    };

    const result = await streamWithFallback(
      SIMULATOR_MODEL,
      messages,
      allTools,
      roundSend,
      estimateTokens,
      totalOut,
    );

    usage.tokensIn += roundIn;
    usage.tokensOut += roundOut;
    usage.actualCost += roundIn * model.inputPrice + roundOut * model.outputPrice;

    // No tool calls → done
    if (!result.hasToolCalls || result.toolCalls.size === 0) break;

    // Add assistant message with tool calls to conversation
    messages.push({
      role: "assistant",
      content: result.textContent || null,
      tool_calls: Array.from(result.toolCalls.values()).map((tc) => ({
        id: tc.id,
        type: "function" as const,
        function: { name: tc.name, arguments: tc.arguments },
      })),
    });

    // Process each tool call
    for (const tc of result.toolCalls.values()) {
      let args: Record<string, unknown> = {};
      try {
        args = JSON.parse(tc.arguments);
      } catch {
        // malformed args — pass empty
      }

      if (tc.name === "ask_clarifying_questions") {
        // Intercepted — emit as a simulator event, not a real tool execution
        const questions = (args.questions as string[]) || [];
        send({ type: "simulator_questions", questions });

        // Push a synthetic tool result so the model can continue
        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: "Questions displayed to user. Waiting for their answers.",
        });
      } else {
        // Standard tool execution (save_artifact, etc.)
        send({ type: "tool_call", name: tc.name });
        const toolResult = await executeTool(tc.name, args, toolContext);

        // Emit tool result events for UI (same logic as chat route)
        const toolResultEvent: Record<string, unknown> = {
          type: "tool_result",
          name: tc.name,
        };
        if (tc.name === "save_artifact") {
          let artifactData: { id?: string; content?: string; category?: string } | undefined;
          try {
            artifactData = JSON.parse(toolResult);
          } catch {
            /* plain text fallback */
          }
          toolResultEvent.artifact = {
            id: artifactData?.id,
            filePath: args.file_path,
            content: args.content,
            category: artifactData?.category || args.category || "other",
            status: "draft",
          };
        }
        if (tc.name === "save_decision") {
          let serverDecisionId: string | undefined;
          try {
            serverDecisionId = JSON.parse(toolResult).id;
          } catch {
            /* plain text fallback */
          }
          toolResultEvent.decision = {
            id: serverDecisionId,
            title: args.title,
            status: "decided",
            choice: args.choice,
            alternatives: args.alternatives || [],
            reasoning: args.reasoning || null,
          };
        }
        send(toolResultEvent);

        messages.push({
          role: "tool",
          tool_call_id: tc.id,
          content: toolResult,
        });
      }
    }
  }

  // Send aggregated usage
  send({
    type: "usage",
    tokensIn: usage.tokensIn,
    tokensOut: usage.tokensOut,
    actualCost: usage.actualCost,
  });
  send({ type: "done", actualModel: "simulator-1.0" });
}
