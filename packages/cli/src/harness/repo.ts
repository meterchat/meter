/**
 * Repo context + command discovery.
 *
 * Meter needs three things from a target repo before it can act:
 *   1. The verification commands (test / typecheck / lint / build) — the judges.
 *   2. Whether tests already exist (drives the test-generation fallback).
 *   3. A compact digest (tree + key config files) to ground the models.
 *
 * Detection is best-effort and language-aware; v0.1 covers Node and Python well,
 * and degrades to static gates for anything else.
 */
import { readFileSync, existsSync, readdirSync, statSync } from "node:fs";
import { join, relative, basename } from "node:path";
import { exec } from "./exec.ts";
import type { RepoCommands, RepoContext } from "../types.ts";

const IGNORE_DIRS = new Set([
  "node_modules", ".git", "dist", "build", ".next", "out", "coverage",
  "__pycache__", ".venv", "venv", ".turbo", ".cache", "target", "vendor",
]);

const TEST_FILE_RE = /(\.|_|^)(test|spec)\.(t|j)sx?$|_test\.py$|test_.*\.py$|\.test\.py$/i;

function readJson(path: string): Record<string, unknown> | null {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/** Detect the JS package manager from lockfiles. */
function detectNodeRunner(root: string): string {
  if (existsSync(join(root, "bun.lock")) || existsSync(join(root, "bun.lockb"))) return "bun";
  if (existsSync(join(root, "pnpm-lock.yaml"))) return "pnpm";
  if (existsSync(join(root, "yarn.lock"))) return "yarn";
  return "npm";
}

function nodeRun(runner: string, script: string): string {
  if (runner === "npm") return `npm run ${script} --silent`;
  if (runner === "yarn") return `yarn ${script}`;
  return `${runner} run ${script}`;
}

function detectCommands(root: string): RepoCommands {
  const pkg = readJson(join(root, "package.json"));
  if (pkg) {
    const runner = detectNodeRunner(root);
    const scripts = (pkg.scripts ?? {}) as Record<string, string>;
    const has = (name: string) => typeof scripts[name] === "string";

    // typecheck: explicit script, else tsc --noEmit if a tsconfig exists.
    const typecheck = has("typecheck")
      ? nodeRun(runner, "typecheck")
      : has("tsc")
        ? nodeRun(runner, "tsc")
        : existsSync(join(root, "tsconfig.json"))
          ? `${runner === "bun" ? "bunx" : "npx"} tsc --noEmit`
          : null;

    return {
      test: has("test") ? nodeRun(runner, "test") : null,
      typecheck,
      lint: has("lint") ? nodeRun(runner, "lint") : null,
      build: has("build") ? nodeRun(runner, "build") : null,
      language: "node",
      runner,
    };
  }

  // Python
  if (
    existsSync(join(root, "pyproject.toml")) ||
    existsSync(join(root, "setup.py")) ||
    existsSync(join(root, "requirements.txt"))
  ) {
    const hasRuff = existsSync(join(root, "ruff.toml")) || existsSync(join(root, ".ruff.toml"));
    return {
      test: "python -m pytest -q",
      typecheck: existsSync(join(root, "mypy.ini")) ? "python -m mypy ." : null,
      lint: hasRuff ? "ruff check ." : null,
      build: null,
      language: "python",
      runner: "python",
    };
  }

  return { test: null, typecheck: null, lint: null, build: null, language: "unknown", runner: null };
}

/** Walk the tree (depth-limited) collecting paths and noting any test files. */
function walk(root: string, maxEntries = 600): { paths: string[]; hasTests: boolean } {
  const paths: string[] = [];
  let hasTests = false;

  const recurse = (dir: string, depth: number) => {
    if (paths.length >= maxEntries || depth > 6) return;
    let entries: string[];
    try {
      entries = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of entries.sort()) {
      if (name.startsWith(".") && name !== ".github") continue;
      if (IGNORE_DIRS.has(name)) continue;
      const full = join(dir, name);
      let s;
      try {
        s = statSync(full);
      } catch {
        continue;
      }
      const rel = relative(root, full);
      if (s.isDirectory()) {
        paths.push(rel + "/");
        recurse(full, depth + 1);
      } else {
        paths.push(rel);
        if (TEST_FILE_RE.test(name)) hasTests = true;
      }
      if (paths.length >= maxEntries) return;
    }
  };

  recurse(root, 0);
  return { paths, hasTests };
}

const KEY_FILES = [
  "package.json", "tsconfig.json", "pyproject.toml", "requirements.txt",
  "README.md", "vitest.config.ts", "jest.config.js", "pytest.ini",
];

/** Build the digest string handed to the models. */
function buildDigest(root: string, paths: string[], commands: RepoCommands): string {
  const tree = paths.slice(0, 400).join("\n");
  const keyFileBlocks: string[] = [];
  for (const f of KEY_FILES) {
    const p = join(root, f);
    if (existsSync(p)) {
      try {
        let content = readFileSync(p, "utf8");
        if (content.length > 2500) content = content.slice(0, 2500) + "\n…(truncated)…";
        keyFileBlocks.push(`### ${f}\n\`\`\`\n${content}\n\`\`\``);
      } catch {
        /* ignore */
      }
    }
  }

  return [
    `# Repo: ${basename(root)}`,
    ``,
    `Verification commands detected:`,
    `- tests: ${commands.test ?? "(none)"}`,
    `- typecheck: ${commands.typecheck ?? "(none)"}`,
    `- lint: ${commands.lint ?? "(none)"}`,
    `- build: ${commands.build ?? "(none)"}`,
    ``,
    `## File tree`,
    "```",
    tree,
    "```",
    ``,
    `## Key files`,
    keyFileBlocks.join("\n\n"),
  ].join("\n");
}

/** Resolve the git repo root for `cwd`. */
export async function gitRoot(cwd: string): Promise<string | null> {
  const r = await exec("git rev-parse --show-toplevel", { cwd, timeoutMs: 10_000 });
  if (r.exitCode !== 0) return null;
  return r.stdout.trim() || null;
}

export async function loadRepoContext(root: string): Promise<RepoContext> {
  const commands = detectCommands(root);
  const { paths, hasTests } = walk(root);
  const digest = buildDigest(root, paths, commands);
  return { root, commands, hasTests, digest };
}
