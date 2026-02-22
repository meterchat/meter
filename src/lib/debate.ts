/**
 * Meter 1.0 Debate Mode — multi-model deliberation engine.
 *
 * Runs three frontier models (Opus 4.6, GPT-5.2, Gemini 3 Pro) through
 * a structured debate, then picks the winning position with conviction.
 *
 * Phases:
 *   1. Opening — each model gives its position
 *   2. Challenge — each model critiques the others
 *   3. Rebuttal (0-2 rounds) — continue if no consensus; models defend/concede
 *   4. Verdict — identify which original position won, commit with conviction
 */

import { streamWithFallback, type Send } from "./fallback";
import { DEBATE_MODELS, shortModelName } from "./models";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

const MAX_DEBATE_ROUNDS = 4; // opening + challenge + up to 2 rebuttals
/** Max recent conversation messages to include as context for debate models */
const MAX_CONTEXT_MESSAGES = 6;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Extract a compact context from the conversation for debate models.
 * Strips system messages and the debate trigger (last user message),
 * keeps only the last few exchanges so models have topic context
 * without ingesting the entire conversation history.
 */
function extractDebateContext(conversation: Message[]): {
  topic: string;
  context: Message[];
} {
  // Filter out system messages
  const nonSystem = conversation.filter((m) => m.role !== "system");

  // The last user message is the debate trigger — skip it for topic extraction
  const userMessages = nonSystem.filter((m) => m.role === "user");
  const realQuestion = userMessages.length >= 2
    ? userMessages[userMessages.length - 2]
    : userMessages[userMessages.length - 1];
  const topic =
    typeof realQuestion?.content === "string"
      ? realQuestion.content
      : "the topic under discussion";

  // Drop the last user message (debate trigger) from context
  const withoutTrigger = nonSystem.slice(0, -1);

  // Keep only the last N messages for cost efficiency
  const trimmed = withoutTrigger.slice(-MAX_CONTEXT_MESSAGES);

  return { topic, context: trimmed };
}

/** Run a single model turn — stream to client, collect text + usage */
async function runModelTurn(
  modelId: string,
  messages: Message[],
  phase: string,
  send: Send,
  usage: { tokensIn: number; tokensOut: number },
): Promise<string> {
  send({ type: "debate_turn_start", model: modelId, phase });

  let content = "";
  let roundIn = 0;
  let roundOut = 0;

  const turnSend: Send = (data) => {
    if (data.type === "delta") {
      content += data.content as string;
      send({ type: "debate_turn_delta", content: data.content, model: modelId });
    }
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
    }
  };

  const totalOut = { value: 0 };
  try {
    await streamWithFallback(modelId, messages, [], turnSend, estimateTokens, totalOut);
  } catch {
    content = "(This model was unavailable for this round.)";
  }

  usage.tokensIn += roundIn;
  usage.tokensOut += roundOut;
  send({ type: "debate_turn_end", model: modelId, phase });

  return content;
}

/** Non-streaming call to check convergence — returns the model id that "won", or null */
async function checkConvergence(
  topic: string,
  debateHistory: string,
  usage: { tokensIn: number; tokensOut: number },
): Promise<string | null> {
  const messages: Message[] = [
    {
      role: "system",
      content: `You are a debate judge. Analyze whether the participants have converged on a single position.

The topic: "${topic}"

Debate so far:
${debateHistory}

Have the models converged on one original position? A position "wins" when:
- The other models have conceded key points to it, OR
- The challenges against it were weak or were effectively rebutted, OR
- Multiple models are now essentially restating the same position

Reply with EXACTLY one of:
- "CONVERGED: model_id" where model_id is the identifier of the model whose original position won (copy it exactly from the debate)
- "NO_CONSENSUS" if positions are still genuinely split

Do not explain. Just the verdict.`,
    },
  ];

  let result = "";
  let roundIn = 0;
  let roundOut = 0;

  const judgeSend: Send = (data) => {
    if (data.type === "delta") result += data.content as string;
    if (data.type === "usage") {
      roundIn = (data.tokensIn as number) || 0;
      roundOut = (data.tokensOut as number) || 0;
    }
  };

  const totalOut = { value: 0 };
  // Use a fast model for the convergence check
  await streamWithFallback(
    "anthropic/claude-sonnet-4.6",
    messages,
    [],
    judgeSend,
    estimateTokens,
    totalOut,
  );

  usage.tokensIn += roundIn;
  usage.tokensOut += roundOut;

  const trimmed = result.trim();
  if (trimmed.startsWith("CONVERGED:")) {
    const winnerId = trimmed.replace("CONVERGED:", "").trim();
    // Validate it's actually one of our debate models
    const match = DEBATE_MODELS.find(
      (id) => id === winnerId || shortModelName(id) === winnerId,
    );
    return match ?? null;
  }
  return null;
}

/** Format the full debate history so far into a readable string */
function formatDebateHistory(
  rounds: { phase: string; positions: Record<string, string> }[],
): string {
  return rounds
    .map((round) => {
      const header = round.phase.charAt(0).toUpperCase() + round.phase.slice(1);
      const entries = DEBATE_MODELS.map(
        (id) => `**${shortModelName(id)}:** ${round.positions[id] || "(unavailable)"}`,
      ).join("\n\n");
      return `## ${header}\n${entries}`;
    })
    .join("\n\n---\n\n");
}

export async function runDebate(conversation: Message[], send: Send) {
  const usage = { tokensIn: 0, tokensOut: 0 };

  // Extract topic (real question, not the debate trigger) and trimmed context
  const { topic, context } = extractDebateContext(conversation);

  // Track all rounds for history
  const rounds: { phase: string; positions: Record<string, string> }[] = [];

  send({ type: "debate_start" });

  // ── Phase 1: Opening positions ──────────────────────────────────
  const openingPositions: Record<string, string> = {};

  for (const modelId of DEBATE_MODELS) {
    const modelName = shortModelName(modelId);
    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${modelName}, one of three AI models in a structured debate. The user's question is below.

Give YOUR OWN position — a single, clear stance. Do NOT simulate other models or present multiple viewpoints. Just your honest take.

Be direct, specific, and concise — 2-3 short paragraphs max. No hedging.`,
      },
      ...context,
    ];

    openingPositions[modelId] = await runModelTurn(
      modelId, messages, "opening", send, usage,
    );
  }

  rounds.push({ phase: "opening", positions: openingPositions });

  // ── Phase 2+: Challenge / Rebuttal rounds ───────────────────────
  let winnerModelId: string | null = null;
  let roundNum = 1; // round 1 = challenge, round 2+ = rebuttal

  while (roundNum < MAX_DEBATE_ROUNDS) {
    const phase = roundNum === 1 ? "challenge" : "rebuttal";
    const roundPositions: Record<string, string> = {};
    const prevRound = rounds[rounds.length - 1];

    for (const modelId of DEBATE_MODELS) {
      const modelName = shortModelName(modelId);
      const otherPositions = DEBATE_MODELS
        .filter((id) => id !== modelId)
        .map(
          (id) =>
            `**${shortModelName(id)}:** ${prevRound.positions[id] || "(unavailable)"}`,
        )
        .join("\n\n");

      const myHistory = rounds
        .map((r) => `[${r.phase}]: ${r.positions[modelId] || ""}`)
        .join("\n\n");

      const systemContent =
        roundNum === 1
          ? `You are ${modelName} in the CHALLENGE round of a structured debate.

Your opening position was:
${openingPositions[modelId]}

The other participants said:
${otherPositions}

Push back hard on weak reasoning. Defend your view where it differs. If another position is genuinely stronger on a point, acknowledge it — but don't cave just to be agreeable. 2-3 short paragraphs. Give ONLY your own response.`
          : `You are ${modelName} in REBUTTAL round ${roundNum - 1} of a structured debate.

Your positions so far:
${myHistory}

The other participants' latest responses:
${otherPositions}

Genuine disagreement remains. Either defend your position with stronger evidence, or concede to the stronger position — don't split the difference. 2-3 short paragraphs. Give ONLY your own response.`;

      const messages: Message[] = [
        { role: "system", content: systemContent },
        ...context,
      ];

      roundPositions[modelId] = await runModelTurn(
        modelId, messages, phase, send, usage,
      );
    }

    rounds.push({ phase, positions: roundPositions });
    roundNum++;

    // Check convergence after this round
    const debateHistory = formatDebateHistory(rounds);
    winnerModelId = await checkConvergence(topic, debateHistory, usage);

    if (winnerModelId) break;
  }

  // ── Final: Verdict with conviction ──────────────────────────────
  const fullDebate = formatDebateHistory(rounds);
  const winnerName = winnerModelId ? shortModelName(winnerModelId) : null;
  const winnerOpening = winnerModelId ? openingPositions[winnerModelId] : null;

  const verdictPrompt = winnerModelId
    ? `You are Meter 1.0, a verdict engine delivering clear answers from multi-model debates.

Three AI models (${DEBATE_MODELS.map(shortModelName).join(", ")}) debated: "${topic}"

Full debate:
${fullDebate}

The debate converged on ${winnerName}'s position:
${winnerOpening}

Present this as the definitive answer with full conviction. Briefly note why others were weaker (1-2 sentences each). Be concise, direct, and actionable.`
    : `You are Meter 1.0, a verdict engine delivering clear answers from multi-model debates.

Three AI models (${DEBATE_MODELS.map(shortModelName).join(", ")}) debated: "${topic}"

Full debate:
${fullDebate}

No clear consensus after ${rounds.length} rounds. Pick the position that held up best under pressure — fewest successful challenges, core argument intact.

You MUST choose one position. Do NOT synthesize a compromise. Briefly explain why (1-2 sentences per rejected position), then deliver the answer. Be concise, direct, and actionable.`;

  // Verdict only needs the system prompt with embedded debate — no conversation context
  const synthesisConvo: Message[] = [
    { role: "system", content: verdictPrompt },
    { role: "user", content: topic },
  ];

  send({ type: "debate_synthesis_start" });

  let synthRoundIn = 0;
  let synthRoundOut = 0;

  const synthSend: Send = (data) => {
    if (data.type === "delta") send(data);
    if (data.type === "usage") {
      synthRoundIn = (data.tokensIn as number) || 0;
      synthRoundOut = (data.tokensOut as number) || 0;
    }
  };

  const totalOut = { value: 0 };
  await streamWithFallback(
    "anthropic/claude-sonnet-4.6",
    synthesisConvo,
    [],
    synthSend,
    estimateTokens,
    totalOut,
  );

  usage.tokensIn += synthRoundIn;
  usage.tokensOut += synthRoundOut;

  send({ type: "usage", tokensIn: usage.tokensIn, tokensOut: usage.tokensOut });
  send({ type: "done", actualModel: "meter-1.0" });
}
