/**
 * FAN-OUT phase — N diverse frontier models generate candidate implementations
 * in parallel, each in its own sandboxed worktree.
 *
 * This is where pass@k beats pass@1: instead of betting on one model's single
 * shot, Meter generates several real, runnable candidates and lets the verifier
 * decide. Each model sees the same task + cross-examined plan + debate transcript,
 * but produces an independent implementation.
 */
import { runModelTurn, CostMeter } from "./turn.ts";
import { shortModelName } from "../providers/models.ts";
import { OUTPUT_PROTOCOL, parseFileEdits } from "./protocol.ts";
import { createWorktree, applyEdits, computeDiff } from "../harness/worktree.ts";
import type { Candidate, Message, RepoContext, Send } from "../types.ts";

const CANDIDATE_SYSTEM = `You are an elite software engineer implementing a task inside an existing repo.
Implement the plan completely and correctly. Write production-quality code that matches
the repo's existing style and conventions. Make the smallest change that fully solves the
task. Ensure the project still type-checks, lints, builds, and that the relevant tests pass.

${OUTPUT_PROTOCOL}`;

/** Build the per-candidate roster: cycle the panel to reach `count`. */
function rosterFor(panel: string[], count: number): string[] {
  const out: string[] = [];
  for (let i = 0; i < count; i++) out.push(panel[i % panel.length]);
  return out;
}

export async function fanout(
  task: string,
  planText: string,
  debateTranscript: string | null,
  repo: RepoContext,
  root: string,
  panel: string[],
  count: number,
  meter: CostMeter,
  send: Send,
): Promise<Candidate[]> {
  send({ type: "phase", phase: "fanout", detail: `${count} candidates` });

  const models = rosterFor(panel, count);
  const debateBlock = debateTranscript
    ? `\n\nENGINEERING REVIEW (incorporate the agreed refinements):\n${debateTranscript}`
    : "";

  const userPrompt = `TASK:\n${task}\n\nPLAN:\n${planText}${debateBlock}\n\nREPOSITORY CONTEXT:\n${repo.digest}\n\nNow implement it. Output only file blocks per the format.`;

  const jobs = models.map((modelId, i) => async (): Promise<Candidate | null> => {
    const id = `c${i + 1}`;
    const name = shortModelName(modelId);
    send({ type: "candidate_start", id, model: name });

    let worktree = "";
    try {
      worktree = await createWorktree(root, id);
      const messages: Message[] = [
        { role: "system", content: CANDIDATE_SYSTEM },
        { role: "user", content: userPrompt },
      ];
      const raw = await runModelTurn(modelId, messages, meter, undefined, {
        excludeModels: models.filter((m) => m !== modelId),
      });

      const edits = parseFileEdits(raw);
      if (edits.length === 0) {
        send({ type: "candidate_failed", id, model: name, reason: "no file edits in output" });
        return { id, model: modelId, edits, worktree, diff: "", raw, repairAttempts: 0 };
      }

      applyEdits(worktree, edits);
      const { diff, filesChanged, diffSize } = await computeDiff(worktree);
      send({ type: "candidate_done", id, model: name, files: edits.map((e) => e.path) });
      void filesChanged;
      void diffSize;
      return { id, model: modelId, edits, worktree, diff, raw, repairAttempts: 0 };
    } catch (err) {
      send({ type: "candidate_failed", id, model: name, reason: (err as Error).message });
      return worktree ? { id, model: modelId, edits: [], worktree, diff: "", raw: "", repairAttempts: 0 } : null;
    }
  });

  const results = await Promise.all(jobs.map((j) => j()));
  send({ type: "cost", cost: meter.snapshot() });
  return results.filter((c): c is Candidate => c !== null);
}
