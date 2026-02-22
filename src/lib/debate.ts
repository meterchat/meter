/**
 * Parameter 1.0 Debate Mode — multi-model deliberation engine.
 *
 * Runs three frontier models through a tight, human-style debate:
 *   1. Opening — each model states their position (2-3 sentences)
 *   2. Cross-exam — each model challenges others + defends (3-5 sentences)
 *   3. Final vote — each model picks the winning position (1 sentence)
 *   4. Verdict — synthesize the winner with conviction
 *
 * Design principles:
 *   - Debate content goes in the USER message so models actually engage
 *   - System prompt is minimal and stable (avoids cache-based repetition)
 *   - Strict word limits enforced via prompt
 *   - Models MUST reference each other by name
 *   - Forced convergence: final vote requires picking a winner
 */

import { streamWithFallback, type Send } from "./fallback";
import { DEBATE_MODELS, shortModelName } from "./models";
import type OpenAI from "openai";

type Message = OpenAI.Chat.ChatCompletionMessageParam;

/** Max recent conversation messages to include as context for debate models */
const MAX_CONTEXT_MESSAGES = 4;

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/** Hardcoded trigger sent by the Debate button in the UI */
const DEBATE_TRIGGER = "Debate this.";

/**
 * Extract a compact context from the conversation for debate models.
 * Strips system messages. If the last user message is the hardcoded debate
 * trigger ("Debate this."), it skips it and uses the prior user message as
 * the topic. Otherwise (user selected Parameter 1.0 and typed their own message),
 * the last user message IS the topic.
 */
function extractDebateContext(conversation: Message[]): {
  topic: string;
  context: Message[];
} {
  const nonSystem = conversation.filter((m) => m.role !== "system");
  const userMessages = nonSystem.filter((m) => m.role === "user");

  const lastUserContent =
    typeof userMessages[userMessages.length - 1]?.content === "string"
      ? (userMessages[userMessages.length - 1].content as string).trim()
      : "";

  const isDebateTrigger = lastUserContent === DEBATE_TRIGGER;

  // If the last message is the "Debate this." trigger, use the prior user
  // message as the real topic; otherwise the last user message IS the topic.
  const realQuestion = isDebateTrigger && userMessages.length >= 2
    ? userMessages[userMessages.length - 2]
    : userMessages[userMessages.length - 1];
  const topic =
    typeof realQuestion?.content === "string"
      ? realQuestion.content
      : "the topic under discussion";

  // Drop the trigger from context if present; keep recent messages
  const withoutTrigger = isDebateTrigger ? nonSystem.slice(0, -1) : nonSystem;
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

export async function runDebate(conversation: Message[], send: Send) {
  const usage = { tokensIn: 0, tokensOut: 0 };
  const { topic, context } = extractDebateContext(conversation);
  const modelNames = DEBATE_MODELS.map(shortModelName);

  send({ type: "debate_start" });

  // ── Phase 1: Opening — short, punchy positions ──────────────────
  const openings: Record<string, string> = {};

  for (const modelId of DEBATE_MODELS) {
    const name = shortModelName(modelId);
    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${name} in a 3-model debate (${modelNames.join(", ")}). Be concise. No bullet points. No lists. No scores. Plain prose only.`,
      },
      ...context,
      {
        role: "user",
        content: `Answer in ONE sentence. A single clear, crisp statement — your position and why. Nothing else.`,
      },
    ];

    openings[modelId] = await runModelTurn(modelId, messages, "opening", send, usage);
  }

  // ── Phase 2: Cross-examination — actual engagement ──────────────
  const challenges: Record<string, string> = {};

  for (const modelId of DEBATE_MODELS) {
    const name = shortModelName(modelId);
    const othersText = DEBATE_MODELS
      .filter((id) => id !== modelId)
      .map((id) => `${shortModelName(id)}: "${openings[id]}"`)
      .join("\n\n");

    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${name} in a 3-model debate. Be concise. No bullet points. No lists. Plain prose only.`,
      },
      ...context,
      {
        role: "assistant",
        content: openings[modelId],
      },
      {
        role: "user",
        content: `The other models responded:\n\n${othersText}\n\nIn 3-5 sentences: Challenge the weakest argument by name. Defend yours if attacked. If someone else is right, say so honestly.`,
      },
    ];

    challenges[modelId] = await runModelTurn(modelId, messages, "challenge", send, usage);
  }

  // ── Phase 3: Final vote — forced convergence ────────────────────
  const votes: Record<string, string> = {};
  const voteResults: Record<string, string> = {};

  const fullDebateText = DEBATE_MODELS.map((id) => {
    const name = shortModelName(id);
    return `${name} opening: "${openings[id]}"\n${name} challenge: "${challenges[id]}"`;
  }).join("\n\n");

  for (const modelId of DEBATE_MODELS) {
    const name = shortModelName(modelId);
    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${name}. You must pick a winner.`,
      },
      {
        role: "user",
        content: `Here's the full debate on "${topic}":\n\n${fullDebateText}\n\nWhich model's position is strongest? You can pick yourself or another model. Reply with ONLY the model name, then a colon, then one sentence explaining why. Example: "GPT-5.2: because their reasoning about X was strongest."`,
      },
    ];

    const voteText = await runModelTurn(modelId, messages, "vote", send, usage);
    votes[modelId] = voteText;

    // Parse which model they voted for
    const voteLower = voteText.toLowerCase();
    for (const candidateId of DEBATE_MODELS) {
      const candidateName = shortModelName(candidateId).toLowerCase();
      if (voteLower.startsWith(candidateName) || voteLower.includes(candidateName + ":")) {
        voteResults[modelId] = candidateId;
        break;
      }
    }
  }

  // Count votes — find who got the most
  const voteCounts: Record<string, number> = {};
  for (const candidateId of DEBATE_MODELS) voteCounts[candidateId] = 0;
  for (const votedFor of Object.values(voteResults)) {
    if (votedFor) voteCounts[votedFor]++;
  }

  let winnerModelId: string | null = null;
  let maxVotes = 0;
  for (const [id, count] of Object.entries(voteCounts)) {
    if (count > maxVotes) {
      maxVotes = count;
      winnerModelId = id;
    }
  }

  // ── Phase 4: Verdict — synthesize with conviction ───────────────
  const winnerName = winnerModelId ? shortModelName(winnerModelId) : null;
  const votesSummary = DEBATE_MODELS
    .map((id) => `${shortModelName(id)} voted for: ${voteResults[id] ? shortModelName(voteResults[id]) : "unclear"}`)
    .join("\n");

  const verdictPrompt = `You are Parameter 1.0, delivering the final answer from a 3-model debate.

Topic: "${topic}"

Debate:
${fullDebateText}

Votes:
${votesSummary}

${winnerModelId
    ? `The debate converged on ${winnerName}'s position (${maxVotes}/${DEBATE_MODELS.length} votes).`
    : `No clear majority. Pick the position that survived challenges best.`}

Write the definitive answer. Lead with the conclusion, then briefly note why the losing positions were weaker (1 sentence each). Be direct and actionable. No meta-commentary about the debate process itself.`;

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
  send({ type: "done", actualModel: "parameter-1.0" });
}
