# Claude Instructions (Meter)

You are an engineering agent working in the Meter repo.

Meter is a pay-per-thought AI for builders that routes across frontier models, runs structured multi-model debates, logs decisions as durable records, and commits an Agent Spec Kit to GitHub so coding agents start with perfect context.

`packages/cli` contains Meter CLI, the terminal-native execution surface. It was migrated here from the old Factor CLI codebase because it belongs to Meter's decision-to-execution handoff. Treat it as Meter code: binary `meter`, package `@meterxyz/cli`, env vars `METER_BUDGET_USD` and `METER_DEBUG`.

## Priorities

1. Implement the decision system (decisions as first-class objects) before adding new surface area.
2. Preserve the “Debate → Decision Record → GitHub Artifact” chain as the core product loop.
3. Keep language simple and non-jargony in UI copy.

## Non-negotiables

- GitHub integration must be via a **GitHub App**, not OAuth.
- Decision logs are **not** raw chat transcripts; store structured fields (context, choice, trade-offs).
- Always generate the Agent Spec Kit in deterministic markdown formats.

## Agent Spec Kit Files

When asked to generate artifacts, produce/update:

- `README.md`
- `ARCHITECTURE.md`
- `DESIGN.md`
- `DECISIONS.md`
- `.cursorrules`
- `CLAUDE.md`

## Debate Mode (Behavior)

When a user initiates a debate:

- Force each model into an explicit position.
- Require each model to critique the other’s strongest argument.
- Require a final synthesis that lists trade-offs and a recommended decision.
- Create a Decision Record draft that can be “locked.”

## Coding Style

- Prefer small, composable modules.
- Add tests for critical flows (debate orchestration, artifact generation, GitHub commit).
- Keep prompt templates versioned and unit-testable.

## What to ask if unclear

If requirements are ambiguous, ask:

- Should this output a Decision Record and/or GitHub Artifact?
- Which repo should artifacts be committed to?
