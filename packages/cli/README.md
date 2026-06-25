# Meter CLI

Meter CLI is the terminal-native execution surface for Meter.

Meter is where builders make decisions with multiple frontier models, record the reasoning, and hand that context to coding agents. The CLI is the handoff layer: it takes a concrete code task, lets models challenge the approach, generates candidate diffs, runs the repo's verification gates, and applies the winner only after approval.

## What It Does

```txt
task
  -> PLAN      one strong model drafts the approach
  -> REVIEW    multiple models challenge the plan
  -> FAN-OUT   candidate diffs are generated in isolated worktrees
  -> VERIFY    tests, typecheck, lint, and build run against each candidate
  -> SELECT    passing candidates beat failing candidates
  -> REPAIR    the closest failed candidate can be fixed and rechecked
  -> RECORD    the winning diff and reasoning land in DECISIONS.md
```

The user sees one final diff, not a wall of competing answers. The model debate is an internal reliability mechanism.

## Install From Source

```sh
cd packages/cli
bun install
bun run build
bun run bin/meter.tsx "add input validation to the signup handler"
```

The CLI needs at least one provider path:

```sh
export OPENROUTER_API_KEY=...
```

Direct provider keys, Bedrock, and OpenRouter all work through the provider fallback layer.

## Commands

```txt
meter [run] "<task>" [options]

  -y, --yes              Apply and commit the winner without prompting
  -c, --candidates <n>   Candidate diffs to generate
      --no-debate        Skip the review phase
      --budget <usd>     Hard spend ceiling, or METER_BUDGET_USD
      --model <ids>      Comma-separated panel override
      --plan-model <id>  Model that drafts the plan
      --plain            Force plain non-TUI output
```

## Safety Model

Meter CLI operates from `HEAD`. Candidate implementations run in throwaway `git worktree` sandboxes. The user's working tree is not modified until the winning diff is approved.

The CLI commits locally and does not push.

## Verification

Verification is the judge. If a repo has tests, Meter runs them. If no tests are found, it can generate a shared test suite once from the task and plan, then run that same suite against every candidate.

Generated tests are surfaced and committed with the winning diff so they are never hidden from review.

## Package

Package: `@meterxyz/cli`  
Binary: `meter`

See [`METER_CLI.md`](./METER_CLI.md) for the product and architecture notes.
