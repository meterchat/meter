#!/usr/bin/env bun
/**
 * meter — the Meter terminal agent.
 *
 * Usage:
 *   meter "add a --json flag to the export command"
 *   meter run "fix the off-by-one in src/paginate.ts" --candidates 3 --budget 0.50
 *
 * Renders the Ink TUI on a TTY; falls back to a plain line renderer when piped
 * or in CI. Both drive the same engine (src/loop.ts) and the same event stream.
 */
import { render } from "ink";
import React from "react";
import App from "../tui/App.tsx";
import Shell from "../tui/Shell.tsx";
import { runMeter, type RunResult } from "../src/loop.ts";
import { defaultConfig } from "../src/config.ts";
import { shortModelName } from "../src/providers/models.ts";
import type { Candidate, MeterConfig, MeterEvent, RepoContext } from "../src/types.ts";

const VERSION = "0.3.1";

function help(): string {
  return `meter ${VERSION} — Meter CLI

  Multi-model review, repo verification, one tested diff.

USAGE
  meter [run] "<task>" [options]

OPTIONS
  -y, --yes              Apply & commit the winner without prompting
  -c, --candidates <n>   Number of candidate implementations to fan out (default 3)
      --no-debate        Skip the cross-examination phase
      --budget <usd>     Hard $ ceiling for the run (or set METER_BUDGET_USD)
      --model <ids>      Comma-separated panel override (OpenRouter ids)
      --plan-model <id>  Model that drafts the plan
      --plain            Force the plain (non-TUI) renderer
  -h, --help             Show this help
  -v, --version          Print version

EXAMPLES
  meter "add input validation to the signup handler"
  meter "refactor src/auth to use the new token store" --candidates 4 --budget 1.00
  meter "fix the failing test in cart.test.ts" -y --plain
`;
}

interface Parsed {
  task: string;
  config: MeterConfig;
  autoApprove: boolean;
  plain: boolean;
}

function parseArgs(argv: string[]): Parsed | { help: true } | { version: true } {
  const args = [...argv];
  if (args[0] === "run") args.shift();

  const config = defaultConfig();
  let autoApprove = false;
  let plain = false;
  const taskParts: string[] = [];

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    const next = () => args[++i];
    switch (a) {
      case "-h": case "--help": return { help: true };
      case "-v": case "--version": return { version: true };
      case "-y": case "--yes": autoApprove = true; break;
      case "--plain": plain = true; break;
      case "--no-debate": config.skipDebate = true; break;
      case "-c": case "--candidates": config.candidates = Math.max(1, Number(next()) || config.candidates); break;
      case "--budget": config.budgetUsd = Number(next()) || config.budgetUsd; break;
      case "--model": config.panel = String(next() ?? "").split(",").map((s) => s.trim()).filter(Boolean); break;
      case "--plan-model": config.planModel = String(next() ?? config.planModel); break;
      default:
        if (a.startsWith("-")) { console.error(`Unknown option: ${a}`); process.exit(2); }
        taskParts.push(a);
    }
  }

  if (!config.panel.length) config.panel = defaultConfig().panel;
  return { task: taskParts.join(" ").trim(), config, autoApprove, plain };
}

function hasAnyKey(): boolean {
  return [
    "ANTHROPIC_API_KEY", "OPENAI_API_KEY", "GEMINI_API_KEY", "XAI_API_KEY",
    "DEEPSEEK_API_KEY", "OPENROUTER_API_KEY", "BEDROCK_API_KEY", "AWS_BEARER_TOKEN_BEDROCK",
  ].some((k) => !!process.env[k]);
}

/** Plain renderer — maps the event stream to console lines (pipe/CI safe). */
function plainSend(e: MeterEvent): void {
  switch (e.type) {
    case "phase": console.log(`\n▸ ${e.phase.toUpperCase()}${e.detail ? `  (${e.detail})` : ""}`); break;
    case "log": console.log(`  ${e.level === "warn" ? "⚠ " : ""}${e.message}`); break;
    case "plan_done": console.log(e.plan); break;
    case "debate_turn_end": console.log(`  · ${e.model} finished ${e.phase}`); break;
    case "debate_done": console.log("  debate complete"); break;
    case "testgen": console.log(`  testgen: ${e.message}`); break;
    case "candidate_start": console.log(`  ${e.id} ${e.model} — generating…`); break;
    case "candidate_done": console.log(`  ${e.id} ${e.model} — ready (${e.files.length} files)`); break;
    case "candidate_failed": console.log(`  ${e.id} ${e.model} — failed: ${e.reason}`); break;
    case "verify_result": {
      const g = e.result.gates.map((x) => `${x.gate} ${x.skipped ? "—" : x.passed ? "✓" : "✗"}`).join(" ");
      console.log(`  ${e.id} ${e.model} — ${e.result.passed ? "PASS" : "fail"}  [${g}]`);
      break;
    }
    case "repair_start": console.log(`  ↻ repairing ${e.id} (${e.model}) attempt ${e.attempt}`); break;
    case "select": console.log(`  → ${e.reason}`); break;
    case "cost": process.stdout.write(`  spend $${e.cost.actualCost.toFixed(4)} (${e.cost.tokensIn}/${e.cost.tokensOut} tok)\r`); break;
    case "done": console.log(`\n  done.`); break;
    case "error": console.error(`\n✗ ${e.message}`); break;
  }
}

function printSummary(r: RunResult): void {
  console.log("\n" + "─".repeat(60));
  if (r.winner) {
    console.log(`Winner: ${shortModelName(r.winner.model)} (${r.winner.id})`);
    if (r.committed) console.log(`Committed: ${r.sha}  ·  record: ${r.decisionsPath}`);
    else if (r.stoppedReason === "declined") console.log("Declined — nothing committed.");
    else console.log("Not committed.");
  } else {
    console.log(`No verified winner${r.stoppedReason ? ` (${r.stoppedReason})` : ""}. Nothing committed.`);
  }
  console.log(`Total cost: $${r.cost.actualCost.toFixed(4)}  ·  ${r.cost.tokensIn.toLocaleString()} in / ${r.cost.tokensOut.toLocaleString()} out`);
  console.log("─".repeat(60));
}

async function main() {
  const parsed = parseArgs(process.argv.slice(2));
  if ("help" in parsed) { console.log(help()); return; }
  if ("version" in parsed) { console.log(VERSION); return; }

  const cwd = process.cwd();
  const dateISO = new Date().toISOString().slice(0, 10);
  const interactive = !parsed.plain && process.stdout.isTTY && process.stdin.isTTY;

  // No task + a real terminal → open the interactive shell ("inside the app").
  if (!parsed.task) {
    if (interactive) {
      // Clear the screen ONCE here, before Ink mounts, so prior terminal history
      // is gone and Ink owns a clean screen. Never clear from inside the component.
      process.stdout.write("\x1b[2J\x1b[3J\x1b[H");
      const { waitUntilExit } = render(
        React.createElement(Shell, { cwd, config: parsed.config, dateISO, hasKey: hasAnyKey() }),
      );
      await waitUntilExit();
      return;
    }
    console.error("Missing task.\n");
    console.log(help());
    process.exit(2);
  }

  if (!hasAnyKey()) {
    console.error("No provider key found. Set at least one of ANTHROPIC_API_KEY / OPENAI_API_KEY / GEMINI_API_KEY / XAI_API_KEY / DEEPSEEK_API_KEY / OPENROUTER_API_KEY (see .env.example).");
    process.exit(1);
  }

  const useTui = interactive;

  if (useTui) {
    let finalResult: RunResult | null = null;
    const { waitUntilExit } = render(
      React.createElement(App, {
        task: parsed.task,
        cwd,
        config: parsed.config,
        dateISO,
        autoApprove: parsed.autoApprove,
        onFinish: (r: RunResult) => { finalResult = r; },
      }),
    );
    await waitUntilExit();
    if (finalResult) printSummary(finalResult);
    return;
  }

  // Plain mode: interactive approval isn't available, so require -y to commit.
  const approve = parsed.autoApprove
    ? undefined
    : async (_w: Candidate, _r: RepoContext) => {
        console.log("\n  (plain mode: pass -y/--yes to apply & commit the winner; skipping commit)");
        return false;
      };
  const r = await runMeter({ task: parsed.task, cwd, config: parsed.config, send: plainSend, dateISO, approve });
  printSummary(r);
}

main().catch((err) => { console.error(err); process.exit(1); });
