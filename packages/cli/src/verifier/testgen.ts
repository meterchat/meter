/**
 * Test generation — the verifier's fallback when a repo ships no tests.
 *
 * Critical design choice: tests are generated ONCE, from the task + plan (the
 * contract every candidate implements), and the SAME suite runs against every
 * candidate. Per-candidate tests would let a model grade its own homework; a
 * single shared suite keeps the judge impartial.
 *
 * The doc's warning stands — generated-test quality bounds correctness — so the
 * generated files are returned to the caller, surfaced for review, and committed
 * alongside the winning diff (not hidden).
 */
import { runModelTurn, CostMeter } from "../core/turn.ts";
import { OUTPUT_PROTOCOL, parseFileEdits } from "../core/protocol.ts";
import type { FileEdit, RepoContext, Send } from "../types.ts";

const TESTGEN_SYSTEM = `You are a meticulous test engineer. The repository under test has NO tests.
Write a focused test suite that verifies the TASK is implemented correctly, testing it
through the public contract described in the PLAN (file paths, function/module names) — NOT
any particular implementation. Cover the happy path and the important edge cases named in
the plan. Tests must be runnable with the repo's standard test command. Do not write trivial
always-pass tests. Use the test framework already configured in the repo if any; otherwise
choose the ecosystem default (Node → vitest/node:test; Python → pytest).

${OUTPUT_PROTOCOL}`;

export interface GeneratedTests {
  edits: FileEdit[];
  raw: string;
}

export async function generateTests(
  task: string,
  planText: string,
  repo: RepoContext,
  model: string,
  meter: CostMeter,
  send: Send,
): Promise<GeneratedTests> {
  send({ type: "testgen", message: `no tests found — generating an impartial suite with ${model}` });

  const raw = await runModelTurn(
    model,
    [
      { role: "system", content: TESTGEN_SYSTEM },
      {
        role: "user",
        content: `TASK:\n${task}\n\nPLAN:\n${planText}\n\nREPOSITORY CONTEXT:\n${repo.digest}\n\nWrite the test files now. Output only file blocks.`,
      },
    ],
    meter,
  );

  const edits = parseFileEdits(raw).filter((e) => e.contents !== null);
  send({
    type: "testgen",
    message: edits.length
      ? `generated ${edits.length} test file(s): ${edits.map((e) => e.path).join(", ")}`
      : "test generation produced no usable files — falling back to static gates",
  });
  return { edits, raw };
}
