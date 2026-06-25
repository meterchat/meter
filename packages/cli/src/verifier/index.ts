/**
 * The verifier — Meter's impartial judge.
 *
 * Instead of letting a model pick the winner (the biased-judge failure mode),
 * Meter runs each candidate against the repo's real gates — tests, typecheck,
 * lint, build — inside its sandboxed worktree. A candidate passes only if every
 * applicable gate passes AND tests actually ran. Reality decides.
 */
import { exec } from "../harness/exec.ts";
import { applyEdits, computeDiff } from "../harness/worktree.ts";
import type {
  Candidate,
  GateName,
  GateResult,
  RepoContext,
  Send,
  VerifyResult,
  FileEdit,
} from "../types.ts";

const GATE_TIMEOUT_MS = 300_000;

async function runGate(
  gate: GateName,
  command: string | null,
  cwd: string,
): Promise<GateResult> {
  if (!command) {
    return { gate, command: "", passed: false, skipped: true, exitCode: null, output: "", durationMs: 0 };
  }
  const r = await exec(command, { cwd, timeoutMs: GATE_TIMEOUT_MS });
  return {
    gate,
    command,
    passed: r.exitCode === 0,
    skipped: false,
    exitCode: r.exitCode,
    output: r.combined,
    durationMs: r.durationMs,
  };
}

/**
 * Verify one candidate. If `generatedTests` are supplied (repo had none), they're
 * written into the worktree first and the test command is overridden so the
 * generated suite is what runs.
 */
export async function verify(
  candidate: Candidate,
  repo: RepoContext,
  send: Send,
  opts: { generatedTests?: FileEdit[]; generatedTestCommand?: string | null } = {},
): Promise<VerifyResult> {
  send({ type: "verify_start", id: candidate.id, model: candidate.model });

  // Dead candidate (no edits / generation failure) — fails fast.
  if (candidate.edits.length === 0 && !opts.generatedTests?.length) {
    const result: VerifyResult = {
      passed: false,
      gates: [],
      filesChanged: 0,
      diffSize: 0,
      testsWereGenerated: false,
    };
    candidate.verify = result;
    send({ type: "verify_result", id: candidate.id, model: candidate.model, result });
    return result;
  }

  const testsWereGenerated = !!opts.generatedTests?.length;
  if (testsWereGenerated) {
    applyEdits(candidate.worktree, opts.generatedTests!);
    // Recompute diff so stats reflect the (shared) generated tests too.
    const d = await computeDiff(candidate.worktree);
    candidate.diff = d.diff;
  }

  const testCommand = testsWereGenerated
    ? (opts.generatedTestCommand ?? repo.commands.test)
    : repo.commands.test;

  // Run gates sequentially (they share the symlinked node_modules; parallel
  // builds in the same tree can race on output dirs).
  const gates: GateResult[] = [];
  gates.push(await runGate("tests", testCommand, candidate.worktree));
  gates.push(await runGate("typecheck", repo.commands.typecheck, candidate.worktree));
  gates.push(await runGate("lint", repo.commands.lint, candidate.worktree));
  gates.push(await runGate("build", repo.commands.build, candidate.worktree));

  const { filesChanged, diffSize } = await computeDiff(candidate.worktree);

  const ranGates = gates.filter((g) => !g.skipped);
  const testsGate = gates.find((g) => g.gate === "tests")!;
  const allRanPassed = ranGates.every((g) => g.passed);
  // A candidate only "passes" if the test gate actually executed and passed —
  // static gates alone are a weaker signal and never count as a real win.
  const passed = allRanPassed && !testsGate.skipped && testsGate.passed && ranGates.length > 0;

  const result: VerifyResult = {
    passed,
    gates,
    filesChanged,
    diffSize,
    testsWereGenerated,
  };
  candidate.verify = result;
  send({ type: "verify_result", id: candidate.id, model: candidate.model, result });
  return result;
}

/** Build a compact failure report for repair — only the gates that failed. */
export function failureReport(result: VerifyResult): string {
  return result.gates
    .filter((g) => !g.skipped && !g.passed)
    .map((g) => `## ${g.gate} FAILED (exit ${g.exitCode}) — \`${g.command}\`\n${g.output}`)
    .join("\n\n");
}
