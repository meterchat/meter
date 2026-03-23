# Meter — Pay Per Thought AI

> The metered AI for everything you think, decide, and build.

Meter gives you every top model — Claude Opus 4.6, Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro, Grok 4.1 Fast, and DeepSeek V3 — on a single postpaid tab. No subscriptions. No rate limits. Multi-tier routing across providers means you always get the fastest, smartest response available. Structured debates pit models against each other when the stakes are high, and a persistent decision log means your context and reasoning never get lost.

--

## What Meter Does

Meter sits between human judgment and machine execution. It is the operating layer for AI-native thinking — the place where decisions are made, recorded, and handed off to coding agents with full fidelity.

**Three core primitives:**

1. **Pay-per-thought routing** — Every frontier model on one postpaid tab. You pay for what you use, never for idle seats. Configurable spend limits protect your budget. Meter routes around rate limits automatically via multi-tier fallback (direct API → OpenRouter → Bedrock).

2. **Structured debate** — When a decision matters, Meter pits models against each other in a 4-phase adversarial framework: Opening → Challenge → Vote → Synthesis. Three models from three independent labs (Anthropic, OpenAI, xAI) attack each other's logic. Every argument is logged. The result is a decision record: timestamped, searchable, citable.

3. **Agent Spec Kit** — When it's time to build, Meter synthesizes decisions and debates into the artifacts your coding agent needs: `ARCHITECTURE.md`, `DECISIONS.md`, `.cursorrules`, `CLAUDE.md`, and more. These commit directly to your GitHub repo so Cursor, Claude Code, and Codex start with perfect context.

---

## Current Phase

Core product is live. Chat, multi-model routing with fallback, debate mode, dissection mode, decision logging, artifact generation, GitHub push, billing with auto-settlement, workspace branching (fork/merge paths), MCP server, developer console with API keys, and public activity log are all working.

---

## How to Run

```bash
# Install dependencies
bun install

# Set up environment variables
cp .env.example .env.local

# Run development server
bun dev
```

---

## Tagline

**Think in Meter. Pay per thought.**

---

## Links

- Production: [meter.chat](https://meter.chat)
