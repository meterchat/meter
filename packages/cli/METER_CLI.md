# Meter CLI

## Positioning

Meter CLI is the execution companion to Meter's decision workspace.

Meter makes decisions first-class: users route across frontier models, run structured debates, and preserve reasoning as durable records. The CLI carries that same pattern into code execution: propose, challenge, verify, record.

It is not a separate product brand. It should be described as **Meter CLI** or **the Meter terminal agent**.

## Product Principle

The user should not manage a panel of model outputs. Meter can use multiple models internally, but the product returns one result: the verified diff.

The visible promise is:

```txt
Meter turns a code task into a tested, reviewable diff.
```

The internal mechanism is:

```txt
multi-model review + candidate generation + repo verification
```

## Scope

In scope:

- terminal-native coding tasks
- repository context gathering
- planning and model review
- candidate diff generation
- sandboxed execution in git worktrees
- tests, typecheck, lint, and build verification
- repair loop for near-passing candidates
- local commit and decision record

Out of scope:

- autonomous background work without user review
- pushing to remotes
- replacing the Meter web app
- becoming the Factor compound model builder

## Architecture

```txt
bin/meter.tsx
  -> tui/App.tsx or plain renderer
  -> src/loop.ts
      -> triage
      -> plan
      -> debate/review
      -> fanout
      -> verifier
      -> selector
      -> repair
      -> record
```

Provider calls go through `src/providers/fallback.ts`, which supports direct provider keys, Bedrock for Claude models, OpenRouter, and cross-model fallback.

## Naming Rules

- Use `Meter CLI` in docs and UI.
- Use `meter` for the binary.
- Use `METER_BUDGET_USD` and `METER_DEBUG` for CLI-specific environment variables.
- Do not call this package Factor.
- Do not use `factor.ac`, `@syedos/factor`, or the Factor compound model builder language here.

## Why This Belongs In Meter

The CLI came from the same product thesis as Meter: multiple models should improve reasoning, but final selection must be grounded in an external check. In the web app, the check is a decision record and handoff artifact. In the CLI, the check is the repo's own verification gates.

That makes it Meter's execution handoff, not the new Factor product.
