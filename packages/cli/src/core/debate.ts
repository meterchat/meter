/**
 * DEBATE phase — models cross-examine the plan at the real forks.
 *
 * Lifted from Meter's debate.ts, minus the ending: Meter KEEPS the opening +
 * cross-examination (the part that makes the work *better* by forcing models to
 * push back and defend) and DELETES Meter's Phase-3 vote tally and Phase-4
 * synthesizer. There is no model "winner" here — debate sharpens the approach,
 * and the test suite later judges the code. The transcript is folded into the
 * fan-out prompt and the decision record.
 */
import { runModelTurn, CostMeter } from "./turn.ts";
import { shortModelName } from "../providers/models.ts";
import type { Message, RepoContext, Send } from "../types.ts";

export interface DebateOutcome {
  /** Full opening + cross-exam transcript, model-attributed. */
  transcript: string;
}

export async function debate(
  task: string,
  planText: string,
  repo: RepoContext,
  roster: string[],
  meter: CostMeter,
  send: Send,
): Promise<DebateOutcome> {
  send({ type: "phase", phase: "debate", detail: roster.map(shortModelName).join(" · ") });
  const names = roster.map(shortModelName);
  const sharedContext = `TASK:\n${task}\n\nPROPOSED PLAN:\n${planText}\n\nREPO (abridged):\n${repo.digest.slice(0, 4000)}`;

  // ── Phase 1: Opening — each model's stance on the plan ──────────
  const openings: Record<string, string> = {};
  for (const modelId of roster) {
    const name = shortModelName(modelId);
    send({ type: "debate_turn_start", model: name, phase: "opening" });
    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${name} in a ${roster.length}-model engineering review (${names.join(", ")}). Plain prose, no lists.`,
      },
      { role: "user", content: `${sharedContext}\n\nIn 2-3 sentences: Is this plan right? Name the single biggest risk or flaw, or the strongest reason it works. Be specific to the code.` },
    ];
    const exclude = roster.filter((m) => m !== modelId);
    openings[modelId] = await runModelTurn(
      modelId,
      messages,
      meter,
      (chunk) => send({ type: "debate_turn_delta", model: name, content: chunk }),
      { excludeModels: exclude },
    );
    send({ type: "debate_turn_end", model: name, phase: "opening" });
  }

  // ── Phase 2: Cross-examination — engage by name ─────────────────
  const challenges: Record<string, string> = {};
  for (const modelId of roster) {
    const name = shortModelName(modelId);
    send({ type: "debate_turn_start", model: name, phase: "challenge" });
    const othersText = roster
      .filter((id) => id !== modelId)
      .map((id) => `${shortModelName(id)}: "${openings[id]}"`)
      .join("\n\n");
    const messages: Message[] = [
      {
        role: "system",
        content: `You are ${name} in a ${roster.length}-model engineering review. Plain prose, no lists.`,
      },
      { role: "user", content: sharedContext },
      { role: "assistant", content: openings[modelId] },
      {
        role: "user",
        content: `The others said:\n\n${othersText}\n\nIn 3-5 sentences: Challenge the weakest point by name. Defend yours if attacked. If someone identified a real problem, concede it and refine the plan. End with the single most important change (if any) the implementation must make.`,
      },
    ];
    const exclude = roster.filter((m) => m !== modelId);
    challenges[modelId] = await runModelTurn(
      modelId,
      messages,
      meter,
      (chunk) => send({ type: "debate_turn_delta", model: name, content: chunk }),
      { excludeModels: exclude },
    );
    send({ type: "debate_turn_end", model: name, phase: "challenge" });
  }

  const transcript = roster
    .map((id) => {
      const n = shortModelName(id);
      return `### ${n}\n**Opening:** ${openings[id]}\n\n**Cross-exam:** ${challenges[id]}`;
    })
    .join("\n\n");

  send({ type: "debate_done", record: transcript });
  send({ type: "cost", cost: meter.snapshot() });
  return { transcript };
}
