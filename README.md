# Meter — Pay Per Thought

> The metered AI for everything you think, decide, and build.

Meter gives you every top model — Claude, GPT, Gemini, and open-source — on a single postpaid tab. No subscriptions. No rate limits. Auto-routing across models means you always get the fastest, smartest response available. Structured debates pit models against each other when the stakes are high, and a persistent decision log means your context and reasoning never get lost.

Connect Stripe, Mercury, Gmail, and more. Open source and end-to-end encrypted — auditable, self-hostable, fully yours.

--

## What Meter Does

Meter sits between human judgment and machine execution. It is the operating layer for AI-native thinking — the place where decisions are made, recorded, and handed off to coding agents with full fidelity.

**Three core primitives:**

1. **Pay-per-thought routing** — Every frontier model on one postpaid tab. You pay for what you use, never for idle seats. Hard wallet caps protect your budget. Meter routes around rate limits automatically.

2. **Structured debate** — When a decision matters, Meter pits models against each other. Claude argues for Postgres, GPT argues for Supabase, Gemini stress-tests both. Every argument is logged. Every dissent is preserved. The result is a decision record: timestamped, searchable, citable.

3. **Agent Spec Kit** — When it's time to build, Meter synthesizes decisions and debates into the artifacts your coding agent needs: `ARCHITECTURE.md`, `DECISIONS.md`, `.cursorrules`, and product requirements. These commit directly to your GitHub repo so Cursor, Claude Code, and Codex start with perfect context.

---

## Three Agent Modes

| Mode | Connectors | Output |
|------|-----------|--------|
| **Planner** | Gmail, Linear, Calendar | Strategy docs, decision logs, debates, follow-ups |
| **Coder** | GitHub, Vercel, Porkbun | Branches, PRs, deploys, live URLs |
| **Banker** | Stripe, Mercury, Puzzle, Gusto | Runway, burn, revenue, spend reviews |

---

## Current Phase

Early-stage product development. Core chat and routing layer in progress. Debate mode and decision logging are the primary differentiators under active development.

---

## How to Run

```bash
# Install dependencies
npm install

# Set up environment variables
cp .env.example .env.local

# Run development server
npm run dev
```

---

## Tagline

**Think in Meter. Pay per thought.**

---

## Links

- Production: [meter.chat](https://meter.chat)
- Repo: [github.com/meterxyz/meter](https://github.com/meterxyz/meter)
