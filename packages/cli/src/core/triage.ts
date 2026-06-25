/**
 * TRIAGE — decide, with one cheap model call, whether the input is an actual
 * code-change task for this repo, or just a question/chat/greeting.
 *
 * Not everything deserves the full plan → debate → fan-out → verify pipeline.
 * "hey should I…", "what does this repo do?", "explain X" → a quick direct answer.
 * Only concrete edit requests run the expensive multi-model pipeline. This is the
 * "base model infers if it's debate-worthy first" behavior.
 */
import { runModelTurn, CostMeter } from "./turn.ts";
import type { Message, RepoContext, Send } from "../types.ts";

const SYSTEM = `You are the front desk of Meter, a coding agent. Read the user's message and the repo.
Decide ONE of two things:

- If it is a concrete request to CREATE OR MODIFY CODE in this repo (implement, fix, refactor,
  add, change, remove, write tests, etc.), reply with exactly: CODE

- Otherwise (a question, a "should I…", asking for advice, an explanation, a greeting, planning,
  or anything not asking you to edit files now), reply with: CHAT
  then a newline, then a direct, helpful answer in your own voice. Be concise and concrete.
  If they're weighing a decision, give a recommendation. No preamble.

First token MUST be CODE or CHAT.`;

export interface Triage {
  kind: "code" | "chat";
  answer: string;
}

export async function triage(
  task: string,
  repo: RepoContext,
  model: string,
  meter: CostMeter,
  send: Send,
): Promise<Triage> {
  const messages: Message[] = [
    { role: "system", content: SYSTEM },
    { role: "user", content: `REPO (abridged):\n${repo.digest.slice(0, 3000)}\n\nUSER MESSAGE:\n${task}` },
  ];

  const text = (await runModelTurn(model, messages, meter)).trim();
  const kind: "code" | "chat" = /^code\b/i.test(text) ? "code" : "chat";
  const answer = text.replace(/^\s*(code|chat)\s*:?\s*/i, "").trim();
  send({ type: "triage", kind });
  if (kind === "chat" && answer) send({ type: "answer_done", text: answer });
  return { kind, answer: kind === "chat" ? answer : "" };
}
