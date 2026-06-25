/**
 * THE LOOP — Meter's orchestrator.
 *
 *   task → PLAN → DEBATE → FAN-OUT → EXECUTE → SELECT → REPAIR → COMMIT + RECORD
 *
 * Models debate the path forward; reality (the test suite) picks the winner.
 * This module owns control flow, the budget ceiling, and the worktree lifecycle;
 * every phase lives in its own file and reports through `send`.
 */
import { CostMeter } from "./core/turn.ts";
import { plan } from "./core/plan.ts";
import { triage } from "./core/triage.ts";
import { debate } from "./core/debate.ts";
import { fanout } from "./core/fanout.ts";
import { verify, failureReport } from "./verifier/index.ts";
import { generateTests } from "./verifier/testgen.ts";
import { select } from "./selector.ts";
import { repair } from "./repair.ts";
import { commitWinner, type RecordEntry } from "./record.ts";
import { route } from "./router.ts";
import { gitRoot, loadRepoContext } from "./harness/repo.ts";
import { isDirty, cleanupCandidates } from "./harness/worktree.ts";
import type {
  Candidate,
  CostSnapshot,
  MeterConfig,
  FileEdit,
  RepoContext,
  Send,
} from "./types.ts";

export interface RunOptions {
  task: string;
  cwd: string;
  config: MeterConfig;
  send: Send;
  /** Today's date (ISO yyyy-mm-dd) — passed in so the engine stays deterministic/testable. */
  dateISO: string;
  /** Called with the winner before committing. Return false to abort the commit. */
  approve?: (winner: Candidate, repo: RepoContext) => Promise<boolean>;
  /** Abort the run (Esc in the shell). Checked at phase boundaries. */
  signal?: AbortSignal;
}

export interface RunResult {
  winner: Candidate | null;
  candidates: Candidate[];
  plan: string;
  debateTranscript: string | null;
  generatedTests: FileEdit[];
  cost: CostSnapshot;
  committed: boolean;
  sha: string | null;
  decisionsPath: string | null;
  stoppedReason: string | null;
  /** "code" (ran the pipeline) or "chat" (quick answer, no pipeline). */
  kind: "code" | "chat";
  /** The direct answer when kind === "chat". */
  answer: string;
}

function nodeTestDefault(repo: RepoContext): string {
  if (repo.commands.test) return repo.commands.test;
  if (repo.commands.language === "python") return "python -m pytest -q";
  return repo.commands.runner === "bun" ? "bun test" : "npx vitest run";
}

export async function runMeter(opts: RunOptions): Promise<RunResult> {
  const { task, cwd, send, dateISO } = opts;
  const meter = new CostMeter();
  const overBudget = () =>
    opts.config.budgetUsd != null && meter.actualCost >= opts.config.budgetUsd;

  const aborted = () => opts.signal?.aborted === true;
  const empty: RunResult = {
    winner: null, candidates: [], plan: "", debateTranscript: null,
    generatedTests: [], cost: meter.snapshot(), committed: false,
    sha: null, decisionsPath: null, stoppedReason: null, kind: "code", answer: "",
  };

  // ── Repo resolution ─────────────────────────────────────────────
  const root = await gitRoot(cwd);
  if (!root) {
    send({ type: "error", message: "Not inside a git repository. Meter needs git for sandboxing and commits." });
    return { ...empty, stoppedReason: "not a git repo" };
  }
  const repo = await loadRepoContext(root);

  // ── TRIAGE — chat vs code (don't run the pipeline on a question) ──
  const verdict = await triage(task, repo, opts.config.planModel, meter, send);
  send({ type: "cost", cost: meter.snapshot() });
  if (verdict.kind === "chat") {
    send({ type: "done", winnerId: null });
    return { ...empty, cost: meter.snapshot(), kind: "chat", answer: verdict.answer, stoppedReason: "chat" };
  }

  if (await isDirty(root)) {
    send({ type: "log", level: "warn", message: "Working tree is dirty — Meter operates from HEAD; uncommitted changes won't be included in candidates." });
  }
  send({ type: "log", level: "info", message: `repo: ${root} · tests: ${repo.hasTests ? "found" : "none (will generate)"}` });

  // ── Router (difficulty gate) ────────────────────────────────────
  const decision = route(task, opts.config);
  const config: MeterConfig = {
    ...opts.config,
    candidates: decision.candidates,
    skipDebate: opts.config.skipDebate || decision.skipDebate,
  };
  send({ type: "log", level: "info", message: `router: ${decision.rationale}` });

  const candidates: Candidate[] = [];
  const cancelled = (planText = "", debateTranscript: string | null = null, generatedTests: FileEdit[] = []): RunResult => {
    send({ type: "log", level: "warn", message: "Cancelled." });
    send({ type: "done", winnerId: null });
    return { ...empty, plan: planText, debateTranscript, generatedTests, cost: meter.snapshot(), stoppedReason: "cancelled" };
  };

  try {
    // ── PLAN ──────────────────────────────────────────────────────
    const planText = await plan(task, repo, config.planModel, meter, send);
    if (aborted()) return cancelled(planText);

    // ── DEBATE ────────────────────────────────────────────────────
    let debateTranscript: string | null = null;
    if (!config.skipDebate && !overBudget()) {
      const outcome = await debate(task, planText, repo, config.panel, meter, send);
      debateTranscript = outcome.transcript;
    }
    if (aborted()) return cancelled(planText, debateTranscript);

    // ── TEST GENERATION (impartial, shared) ───────────────────────
    let generatedTests: FileEdit[] = [];
    let generatedTestCommand: string | null = null;
    if (!repo.hasTests && !overBudget()) {
      const gen = await generateTests(task, planText, repo, config.planModel, meter, send);
      generatedTests = gen.edits;
      generatedTestCommand = nodeTestDefault(repo);
    }
    if (aborted()) return cancelled(planText, debateTranscript, generatedTests);

    if (overBudget()) {
      send({ type: "log", level: "warn", message: `Budget $${config.budgetUsd} reached before fan-out.` });
      return { ...empty, plan: planText, debateTranscript, cost: meter.snapshot(), stoppedReason: "budget" };
    }

    // ── FAN-OUT ───────────────────────────────────────────────────
    const generated = await fanout(task, planText, debateTranscript, repo, root, config.panel, config.candidates, meter, send);
    candidates.push(...generated);

    // ── EXECUTE (verify each candidate sequentially) ──────────────
    send({ type: "phase", phase: "execute", detail: `${candidates.length} candidates` });
    for (const c of candidates) {
      if (aborted()) return cancelled(planText, debateTranscript, generatedTests);
      await verify(c, repo, send, { generatedTests, generatedTestCommand });
    }
    send({ type: "cost", cost: meter.snapshot() });

    // ── SELECT + REPAIR loop ──────────────────────────────────────
    let { winner, repairTarget } = select(candidates, send);
    let repairsDone = 0;
    while (!winner && repairTarget && repairsDone < config.maxRepairs && !overBudget() && !aborted()) {
      send({ type: "phase", phase: "repair", detail: `attempt ${repairsDone + 1}/${config.maxRepairs}` });
      const fr = repairTarget.verify ? failureReport(repairTarget.verify) : "(no gate output)";
      await repair(repairTarget, task, planText, repo, fr, meter, send);
      await verify(repairTarget, repo, send, { generatedTests, generatedTestCommand });
      repairsDone += 1;
      ({ winner, repairTarget } = select(candidates, send));
    }
    send({ type: "cost", cost: meter.snapshot() });

    if (!winner) {
      const reason = overBudget() ? "budget" : "no candidate passed verification";
      send({ type: "log", level: "warn", message: `No verified winner (${reason}). Nothing committed.` });
      send({ type: "done", winnerId: null });
      return {
        winner: null, candidates, plan: planText, debateTranscript, generatedTests,
        cost: meter.snapshot(), committed: false, sha: null, decisionsPath: null,
        stoppedReason: reason, kind: "code", answer: "",
      };
    }

    // ── Approval gate ─────────────────────────────────────────────
    if (opts.approve) {
      const ok = await opts.approve(winner, repo);
      if (!ok) {
        send({ type: "log", level: "info", message: "Winner not applied (declined)." });
        send({ type: "done", winnerId: winner.id });
        return {
          winner, candidates, plan: planText, debateTranscript, generatedTests,
          cost: meter.snapshot(), committed: false, sha: null, decisionsPath: null,
          stoppedReason: "declined", kind: "code", answer: "",
        };
      }
    }

    // ── COMMIT + RECORD ───────────────────────────────────────────
    const entry: RecordEntry = {
      task, plan: planText, debateTranscript, winner, considered: candidates,
      generatedTests,
      totalCostUsd: meter.actualCost,
      tokensIn: meter.tokensIn, tokensOut: meter.tokensOut,
    };
    const { committed, sha, decisionsPath } = await commitWinner(root, entry, dateISO, send);

    send({ type: "cost", cost: meter.snapshot() });
    send({ type: "done", winnerId: winner.id });
    return {
      winner, candidates, plan: planText, debateTranscript, generatedTests,
      cost: meter.snapshot(), committed, sha, decisionsPath, stoppedReason: null,
      kind: "code", answer: "",
    };
  } finally {
    await cleanupCandidates(root, candidates);
  }
}
