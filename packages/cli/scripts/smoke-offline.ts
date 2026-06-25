/**
 * Offline integration smoke test — exercises everything in the loop EXCEPT model
 * calls: protocol parsing, git worktree sandboxing, file edits, diff computation,
 * the verifier's real gate execution, and selector ranking. No API keys, no spend.
 *
 * Run: bun run scripts/smoke-offline.ts
 */
import { mkdtempSync, writeFileSync, mkdirSync, rmSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exec } from "../src/harness/exec.ts";
import { loadRepoContext, gitRoot } from "../src/harness/repo.ts";
import { createWorktree, applyEdits, computeDiff, removeWorktree } from "../src/harness/worktree.ts";
import { parseFileEdits } from "../src/core/protocol.ts";
import { verify } from "../src/verifier/index.ts";
import { rankCandidates, select } from "../src/selector.ts";
import type { Candidate, Send } from "../src/types.ts";

const log = (m: string) => console.log(m);
const silent: Send = () => {};
let failures = 0;
function check(name: string, cond: boolean) {
  log(`  ${cond ? "✓" : "✗"} ${name}`);
  if (!cond) failures++;
}

async function main() {
  // ── Build a throwaway git repo: a buggy add() + a real test ──────
  const dir = mkdtempSync(join(tmpdir(), "meter-smoke-"));
  log(`repo: ${dir}\n`);
  mkdirSync(join(dir, "src"));
  mkdirSync(join(dir, "test"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({
    name: "smoke", version: "1.0.0", type: "module",
    scripts: { test: "node --test" },
  }, null, 2));
  writeFileSync(join(dir, "src/add.js"), `export function add(a, b) { return a - b; } // BUG\n`);
  writeFileSync(join(dir, "test/add.test.js"),
    `import test from "node:test";\nimport assert from "node:assert";\nimport { add } from "../src/add.js";\ntest("add", () => { assert.equal(add(2, 3), 5); });\n`);

  await exec("git init -q && git add -A && git -c user.email=a@b.c -c user.name=meter commit -qm init", { cwd: dir });

  // ── 1. Protocol parsing ──────────────────────────────────────────
  log("protocol:");
  const raw = `noise\n<<<FILE: src/add.js>>>\nexport function add(a, b) { return a + b; }\n<<<END>>>\n<<<DELETE: src/old.js>>>\n`;
  const edits = parseFileEdits(raw);
  check("parses one FILE + one DELETE", edits.length === 2);
  check("FILE has contents", edits[0].path === "src/add.js" && edits[0].contents?.includes("a + b") === true);
  check("DELETE has null contents", edits[1].path === "src/old.js" && edits[1].contents === null);
  check("rejects path traversal", parseFileEdits(`<<<FILE: ../evil>>>\nx\n<<<END>>>`).length === 0);

  // ── 2. Repo context detection ────────────────────────────────────
  log("\nrepo context:");
  const root = await gitRoot(dir);
  check("gitRoot resolves", root === realpathSync(dir)); // macOS canonicalizes /var → /private/var
  const repo = await loadRepoContext(dir);
  check("detects node test command (npm script)", repo.commands.test === "npm run test --silent" && repo.commands.language === "node");
  check("detects existing tests", repo.hasTests === true);

  // ── 3+4. Harness + verifier on a PASSING candidate (correct fix) ─
  log("\nharness + verifier (passing candidate):");
  const goodWt = await createWorktree(dir, "good");
  applyEdits(goodWt, parseFileEdits(`<<<FILE: src/add.js>>>\nexport function add(a, b) { return a + b; }\n<<<END>>>`));
  const goodDiff = await computeDiff(goodWt);
  check("computes a diff", goodDiff.filesChanged === 1 && goodDiff.diffSize > 0);
  const good: Candidate = { id: "good", model: "anthropic/claude-opus-4.6", edits: parseFileEdits(`<<<FILE: src/add.js>>>\nexport function add(a, b) { return a + b; }\n<<<END>>>`), worktree: goodWt, diff: goodDiff.diff, raw: "", repairAttempts: 0 };
  const goodRes = await verify(good, repo, silent);
  check("passing candidate passes tests gate", goodRes.passed === true);

  // ── verifier on a FAILING candidate (keeps the bug) ──────────────
  log("\nverifier (failing candidate):");
  const badWt = await createWorktree(dir, "bad");
  applyEdits(badWt, parseFileEdits(`<<<FILE: src/add.js>>>\nexport function add(a, b) { return a * b; }\n<<<END>>>`));
  const badDiff = await computeDiff(badWt);
  const bad: Candidate = { id: "bad", model: "x-ai/grok-4.1-fast", edits: [{ path: "src/add.js", contents: "export function add(a, b) { return a * b; }" }], worktree: badWt, diff: badDiff.diff, raw: "", repairAttempts: 0 };
  const badRes = await verify(bad, repo, silent);
  check("failing candidate fails tests gate", badRes.passed === false);

  // ── 5. Selector ─────────────────────────────────────────────────
  log("\nselector:");
  const ranked = rankCandidates([bad, good]);
  check("ranks passing candidate first", ranked[0].id === "good");
  const sel = select([bad, good], silent);
  check("selects the passing winner", sel.winner?.id === "good");
  check("no repair target when a winner exists", sel.repairTarget === null);
  const noneSel = select([bad], silent);
  check("repair target set when none pass", noneSel.winner === null && noneSel.repairTarget?.id === "bad");

  // ── cleanup ──────────────────────────────────────────────────────
  await removeWorktree(dir, goodWt);
  await removeWorktree(dir, badWt);
  rmSync(dir, { recursive: true, force: true });

  log(`\n${failures === 0 ? "✓ ALL PASSED" : `✗ ${failures} FAILED`}`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });
