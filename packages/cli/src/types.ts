/**
 * Shared types for the Meter engine.
 *
 * The engine is event-driven: every phase streams progress through a `send`
 * callback (the same primitive Meter inherits from Meter's debate). Both the
 * Ink TUI and the plain (pipe/CI) renderer consume these events, so the core
 * never imports anything UI-specific.
 */
import type OpenAI from "openai";

export type Message = OpenAI.Chat.ChatCompletionMessageParam;

/* ─── Event protocol ────────────────────────────────────────────── */

export type MeterEvent =
  | { type: "phase"; phase: Phase; detail?: string }
  | { type: "log"; level: "info" | "warn" | "error"; message: string }
  // triage (chat vs code) + quick chat answer
  | { type: "triage"; kind: "code" | "chat" }
  | { type: "answer_delta"; content: string }
  | { type: "answer_done"; text: string }
  // plan
  | { type: "plan_delta"; content: string }
  | { type: "plan_done"; plan: string }
  // debate
  | { type: "debate_turn_start"; model: string; phase: "opening" | "challenge" }
  | { type: "debate_turn_delta"; model: string; content: string }
  | { type: "debate_turn_end"; model: string; phase: "opening" | "challenge" }
  | { type: "debate_done"; record: string }
  // fan-out
  | { type: "candidate_start"; id: string; model: string }
  | { type: "candidate_delta"; id: string; model: string; content: string }
  | { type: "candidate_done"; id: string; model: string; files: string[] }
  | { type: "candidate_failed"; id: string; model: string; reason: string }
  // verify
  | { type: "verify_start"; id: string; model: string }
  | { type: "verify_result"; id: string; model: string; result: VerifyResult }
  | { type: "testgen"; message: string }
  // select / repair
  | { type: "select"; winnerId: string | null; model: string | null; reason: string }
  | { type: "repair_start"; id: string; model: string; attempt: number }
  // cost
  | { type: "cost"; cost: CostSnapshot }
  // terminal
  | { type: "done"; winnerId: string | null }
  | { type: "error"; message: string };

export type Send = (e: MeterEvent) => void;

export type Phase =
  | "plan"
  | "debate"
  | "fanout"
  | "execute"
  | "select"
  | "repair"
  | "commit";

/* ─── Cost ──────────────────────────────────────────────────────── */

export interface CostSnapshot {
  tokensIn: number;
  tokensOut: number;
  cacheCreationTokens: number;
  cacheReadTokens: number;
  /** Actual dollar cost summed across every model turn (base rate). */
  actualCost: number;
}

/* ─── Verification ──────────────────────────────────────────────── */

export type GateName = "tests" | "typecheck" | "lint" | "build";

export interface GateResult {
  gate: GateName;
  /** Command that was run, e.g. "bun test". */
  command: string;
  passed: boolean;
  /** True when the gate doesn't apply to this repo (no command found). */
  skipped: boolean;
  exitCode: number | null;
  /** Trimmed tail of stdout+stderr — fed back into repair on failure. */
  output: string;
  durationMs: number;
}

export interface VerifyResult {
  /** Overall pass = every non-skipped gate passed AND tests were actually run. */
  passed: boolean;
  gates: GateResult[];
  /** Number of files the candidate changed (selector tie-break: smaller wins). */
  filesChanged: number;
  /** Lines added+removed across the candidate diff (tie-break). */
  diffSize: number;
  /** Whether the tests gate ran real (not generated) tests. */
  testsWereGenerated: boolean;
}

/* ─── Candidates ────────────────────────────────────────────────── */

export interface FileEdit {
  path: string;
  /** Full new contents, or null for a deletion. */
  contents: string | null;
}

export interface Candidate {
  id: string;
  model: string;
  edits: FileEdit[];
  /** Absolute path to this candidate's isolated git worktree. */
  worktree: string;
  /** Unified diff vs. the base, for review/display. */
  diff: string;
  raw: string;
  verify?: VerifyResult;
  repairAttempts: number;
}

/* ─── Repo / config ─────────────────────────────────────────────── */

export interface RepoCommands {
  test: string | null;
  typecheck: string | null;
  lint: string | null;
  build: string | null;
  /** Detected ecosystem, drives test generation. */
  language: "node" | "python" | "unknown";
  /** Package manager / runner prefix, e.g. "bun", "npm", "pnpm". */
  runner: string | null;
}

export interface RepoContext {
  root: string;
  commands: RepoCommands;
  /** Whether any test files were discovered on disk. */
  hasTests: boolean;
  /** A compact tree + key-file digest fed to the models as context. */
  digest: string;
}

export interface MeterConfig {
  /** Models in the fan-out panel (candidate generators). */
  panel: string[];
  /** Strong model that drafts the plan. */
  planModel: string;
  /** Number of candidate diffs to generate (≤ panel.length, cycles if fewer). */
  candidates: number;
  /** Max repair iterations per run before giving up. */
  maxRepairs: number;
  /** Hard $ ceiling for the run; null = uncapped. */
  budgetUsd: number | null;
  /** Skip the debate phase (easy turns / router gate). */
  skipDebate: boolean;
}
