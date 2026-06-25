/**
 * PLAN phase — one strong model drafts the approach.
 *
 * This is deliberately a single model (not a panel): a clear, concrete plan that
 * the debate then stress-tests and the fan-out then implements. The plan is about
 * *approach*, not code — files to touch, the shape of the change, edge cases,
 * which tests prove it.
 */
import { runModelTurn, CostMeter } from "./turn.ts";
import type { Message, RepoContext, Send } from "../types.ts";

const PLAN_SYSTEM = `You are the planning lead of Meter, an autonomous coding agent.
Given a task and a repository, produce a CONCRETE implementation plan: the files to
create or modify, the shape of the change, edge cases to handle, and exactly which
tests would prove the change correct. Be specific to THIS repo — reference real
paths and symbols from the digest. No code yet. Keep it tight: a numbered plan, not
an essay. Lead with a one-sentence summary of the approach.`;

export async function plan(
  task: string,
  repo: RepoContext,
  planModel: string,
  meter: CostMeter,
  send: Send,
): Promise<string> {
  send({ type: "phase", phase: "plan", detail: planModel });

  const messages: Message[] = [
    { role: "system", content: PLAN_SYSTEM },
    {
      role: "user",
      content: `TASK:\n${task}\n\nREPOSITORY CONTEXT:\n${repo.digest}`,
    },
  ];

  const text = await runModelTurn(planModel, messages, meter, (chunk) =>
    send({ type: "plan_delta", content: chunk }),
  );

  send({ type: "plan_done", plan: text });
  send({ type: "cost", cost: meter.snapshot() });
  return text;
}
