/**
 * REPAIR — feed failures back to the closest candidate and try again.
 *
 * When no candidate passes, Meter doesn't give up or re-roll from scratch: it
 * hands the best failing candidate its own current diff plus the exact gate
 * output that failed, and asks for a fix. The patched files go back into the
 * SAME worktree and re-verify. The loop runs until green or the budget/attempt
 * cap is hit.
 */
import { runModelTurn, CostMeter } from "./core/turn.ts";
import { shortModelName } from "./providers/models.ts";
import { OUTPUT_PROTOCOL, parseFileEdits } from "./core/protocol.ts";
import { applyEdits, computeDiff } from "./harness/worktree.ts";
import type { Candidate, Message, RepoContext, Send } from "./types.ts";

const REPAIR_SYSTEM = `You are an elite software engineer fixing a failing implementation.
You are given the task, your current diff, and the EXACT output of the gate(s) that failed.
Diagnose the real cause and fix it. Change as little as possible. Re-emit the COMPLETE
contents of every file you touch (including files you previously wrote that still need to
change). Do not "fix" by weakening or deleting tests.

${OUTPUT_PROTOCOL}`;

export async function repair(
  candidate: Candidate,
  task: string,
  planText: string,
  repo: RepoContext,
  failure: string,
  meter: CostMeter,
  send: Send,
): Promise<Candidate> {
  candidate.repairAttempts += 1;
  send({
    type: "repair_start",
    id: candidate.id,
    model: shortModelName(candidate.model),
    attempt: candidate.repairAttempts,
  });

  const messages: Message[] = [
    { role: "system", content: REPAIR_SYSTEM },
    {
      role: "user",
      content: `TASK:\n${task}\n\nPLAN:\n${planText}\n\nYOUR CURRENT DIFF:\n\`\`\`diff\n${candidate.diff.slice(0, 60_000)}\n\`\`\`\n\nFAILING GATE OUTPUT:\n${failure.slice(0, 40_000)}\n\nFix it. Output only file blocks for the files you are changing.`,
    },
  ];

  const raw = await runModelTurn(candidate.model, messages, meter);
  const edits = parseFileEdits(raw);

  if (edits.length > 0) {
    applyEdits(candidate.worktree, edits);
    // Merge edits into the candidate's running edit set (later edits win).
    const byPath = new Map(candidate.edits.map((e) => [e.path, e]));
    for (const e of edits) byPath.set(e.path, e);
    candidate.edits = [...byPath.values()];

    const { diff } = await computeDiff(candidate.worktree);
    candidate.diff = diff;
    candidate.raw = raw;
  }

  send({ type: "cost", cost: meter.snapshot() });
  return candidate;
}
