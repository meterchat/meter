/**
 * Per-candidate sandboxes via `git worktree`.
 *
 * Each candidate gets its own checkout of HEAD in a throwaway worktree that
 * shares the repo's object store (cheap — no full clone). Candidates write their
 * edits there and the verifier runs there, so N candidates never collide and the
 * user's working tree is never touched until a winner is committed.
 *
 * v0.1 contract: Meter operates from HEAD. If the working tree is dirty the
 * orchestrator warns — uncommitted changes are not carried into the sandboxes.
 */
import { mkdirSync, writeFileSync, rmSync, existsSync, symlinkSync } from "node:fs";
import { dirname, join, isAbsolute } from "node:path";
import { tmpdir } from "node:os";
import { exec } from "./exec.ts";
import type { Candidate, FileEdit } from "../types.ts";

let counter = 0;

/**
 * A fresh worktree checks out HEAD but has no installed dependencies (node_modules
 * etc. are gitignored). Symlink them from the main repo so the verifier's gates can
 * actually run without a per-candidate install. Best-effort and non-fatal.
 */
const LINKABLE_DEPS = ["node_modules", ".venv", "venv", "vendor"];

function linkDependencies(root: string, worktree: string): void {
  for (const dep of LINKABLE_DEPS) {
    const src = join(root, dep);
    const dest = join(worktree, dep);
    if (existsSync(src) && !existsSync(dest)) {
      try {
        symlinkSync(src, dest, "dir");
      } catch {
        /* non-fatal — gate may fail to resolve deps, which is surfaced as a gate failure */
      }
    }
  }
}

/** Is the repo's working tree dirty (uncommitted changes)? */
export async function isDirty(root: string): Promise<boolean> {
  const r = await exec("git status --porcelain", { cwd: root, timeoutMs: 10_000 });
  return r.stdout.trim().length > 0;
}

/** Create an isolated worktree checked out at HEAD. Returns its absolute path. */
export async function createWorktree(root: string, id: string): Promise<string> {
  counter += 1;
  const path = join(tmpdir(), `meter-${process.pid}-${counter}-${id}`);
  const r = await exec(`git worktree add --detach ${shellQuote(path)} HEAD`, {
    cwd: root,
    timeoutMs: 60_000,
  });
  if (r.exitCode !== 0) {
    throw new Error(`git worktree add failed: ${r.combined}`);
  }
  linkDependencies(root, path);
  return path;
}

/** Write a candidate's edits into a worktree (creating/deleting files). */
export function applyEdits(worktree: string, edits: FileEdit[]): void {
  for (const e of edits) {
    if (isAbsolute(e.path) || e.path.includes("..")) {
      throw new Error(`refusing unsafe edit path: ${e.path}`);
    }
    const full = join(worktree, e.path);
    if (e.contents === null) {
      try {
        rmSync(full, { force: true });
      } catch {
        /* already gone */
      }
    } else {
      mkdirSync(dirname(full), { recursive: true });
      writeFileSync(full, e.contents, "utf8");
    }
  }
}

// Exclude the dependency symlinks we add — a symlink named `node_modules` isn't
// matched by a `node_modules/` gitignore rule, so without this it would be staged.
const EXCLUDE_PATHSPEC = LINKABLE_DEPS.map((d) => `':(exclude)${d}'`).join(" ");

/** Stage everything (except linked deps) and return the unified diff + stats vs HEAD. */
export async function computeDiff(
  worktree: string,
): Promise<{ diff: string; filesChanged: number; diffSize: number }> {
  await exec(`git add -A -- . ${EXCLUDE_PATHSPEC}`, { cwd: worktree, timeoutMs: 30_000 });
  const diffRes = await exec("git diff --cached", { cwd: worktree, timeoutMs: 30_000, tailChars: 200_000 });
  const statRes = await exec("git diff --cached --numstat", { cwd: worktree, timeoutMs: 30_000 });

  let filesChanged = 0;
  let diffSize = 0;
  for (const line of statRes.stdout.split("\n")) {
    const m = line.match(/^(\d+|-)\t(\d+|-)\t/);
    if (!m) continue;
    filesChanged += 1;
    diffSize += (m[1] === "-" ? 0 : Number(m[1])) + (m[2] === "-" ? 0 : Number(m[2]));
  }

  return { diff: diffRes.stdout, filesChanged, diffSize };
}

/** Remove a candidate's worktree. Best-effort — never throws. */
export async function removeWorktree(root: string, path: string): Promise<void> {
  await exec(`git worktree remove --force ${shellQuote(path)}`, { cwd: root, timeoutMs: 30_000 });
  try {
    rmSync(path, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

/** Tear down every candidate's worktree. */
export async function cleanupCandidates(root: string, candidates: Candidate[]): Promise<void> {
  for (const c of candidates) {
    if (c.worktree) await removeWorktree(root, c.worktree);
  }
  await exec("git worktree prune", { cwd: root, timeoutMs: 15_000 });
}

function shellQuote(s: string): string {
  return `'${s.replace(/'/g, `'\\''`)}'`;
}
