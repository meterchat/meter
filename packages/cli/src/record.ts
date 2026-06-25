/**
 * COMMIT + RECORD — apply the winning diff and write the "why" into the repo.
 *
 * This is half of Meter's moat (per the doc): the compounding decision-record
 * memory committed alongside every change. Per Ali's call, the record is a local
 * DECISIONS.md (ADR format, lifted from Meter) committed into the target repo —
 * no Supabase, no GitHub App. Meter commits locally; pushing stays the user's
 * choice.
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exec } from "./harness/exec.ts";
import { applyEdits } from "./harness/worktree.ts";
import { shortModelName } from "./providers/models.ts";
import type { Candidate, FileEdit, Send, VerifyResult } from "./types.ts";

export interface RecordEntry {
  task: string;
  plan: string;
  debateTranscript: string | null;
  winner: Candidate;
  considered: Candidate[];
  generatedTests: FileEdit[];
  totalCostUsd: number;
  tokensIn: number;
  tokensOut: number;
}

function nextAdrNumber(decisionsPath: string): number {
  if (!existsSync(decisionsPath)) return 1;
  const text = readFileSync(decisionsPath, "utf8");
  let max = 0;
  for (const m of text.matchAll(/ADR-(\d{4})/g)) max = Math.max(max, Number(m[1]));
  return max + 1;
}

function gateLine(v: VerifyResult): string {
  return v.gates
    .map((g) => `${g.gate} ${g.skipped ? "—" : g.passed ? "✓" : "✗"}`)
    .join("  ");
}

function firstLine(s: string): string {
  return (s.split("\n").find((l) => l.trim()) ?? "").trim();
}

export function buildAdr(n: number, e: RecordEntry, dateISO: string): string {
  const num = String(n).padStart(4, "0");
  const consideredLines = e.considered
    .map((c) => {
      const v = c.verify;
      const verdict = v?.passed ? "PASS" : "fail";
      const stats = v ? ` (${gateLine(v)})` : "";
      return `  - ${shortModelName(c.model)} [${c.id}] — ${verdict}${stats}`;
    })
    .join("\n");

  const testsLine = e.generatedTests.length
    ? `generated ${e.generatedTests.length} test file(s) (no tests existed): ${e.generatedTests.map((t) => t.path).join(", ")}`
    : "ran the repo's existing tests";

  return `## ADR-${num}: ${firstLine(e.task)}

- Date: ${dateISO}
- Status: Accepted
- Decided by: Meter (multi-model fan-out, verified by tests)

### Task
${e.task}

### Approach
${e.plan.trim()}

${e.debateTranscript ? `### Why — engineering review\n${e.debateTranscript.trim()}\n` : ""}
### Verification
- Winner: **${shortModelName(e.winner.model)}** (candidate ${e.winner.id})
- Gates: ${e.winner.verify ? gateLine(e.winner.verify) : "n/a"}
- Tests: ${testsLine}
- Candidates considered:
${consideredLines}

### Cost
$${e.totalCostUsd.toFixed(4)} · ${e.tokensIn.toLocaleString()} tokens in / ${e.tokensOut.toLocaleString()} out
`;
}

/** Append the ADR to DECISIONS.md, creating the file with a header if absent. */
export function writeDecisionRecord(root: string, e: RecordEntry, dateISO: string): { path: string; adr: string } {
  const path = join(root, "DECISIONS.md");
  const n = nextAdrNumber(path);
  const adr = buildAdr(n, e, dateISO);

  if (existsSync(path)) {
    const existing = readFileSync(path, "utf8").replace(/\s+$/, "");
    writeFileSync(path, `${existing}\n\n${adr}`, "utf8");
  } else {
    const header = `# Decisions\n\nArchitecture decision records, written by Meter — the *why* behind every committed change.\n\n`;
    writeFileSync(path, header + adr, "utf8");
  }
  return { path, adr };
}

/**
 * Apply the winning candidate (and shared generated tests) to the repo's working
 * tree, write the decision record, and commit both together. Does NOT push.
 */
export async function commitWinner(
  root: string,
  e: RecordEntry,
  dateISO: string,
  send: Send,
): Promise<{ committed: boolean; sha: string | null; decisionsPath: string }> {
  send({ type: "phase", phase: "commit", detail: shortModelName(e.winner.model) });

  // Write code + generated tests into the real working tree.
  applyEdits(root, e.winner.edits);
  if (e.generatedTests.length) applyEdits(root, e.generatedTests);

  const { path: decisionsPath } = writeDecisionRecord(root, e, dateISO);

  await exec("git add -A", { cwd: root, timeoutMs: 30_000 });
  const subject = `meter: ${firstLine(e.task).slice(0, 60)}`;
  const body = `Implemented by ${shortModelName(e.winner.model)} (candidate ${e.winner.id}), verified by tests.\nCost $${e.totalCostUsd.toFixed(4)}. See DECISIONS.md.`;
  const msg = `${subject}\n\n${body}`;
  const commit = await exec(`git commit -m ${shellQuote(msg)}`, { cwd: root, timeoutMs: 30_000 });

  if (commit.exitCode !== 0) {
    send({ type: "log", level: "warn", message: `git commit failed: ${commit.combined}` });
    return { committed: false, sha: null, decisionsPath };
  }
  const sha = (await exec("git rev-parse --short HEAD", { cwd: root, timeoutMs: 10_000 })).stdout.trim();
  send({ type: "log", level: "info", message: `committed ${sha} (not pushed)` });
  return { committed: true, sha, decisionsPath };
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
