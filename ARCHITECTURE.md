# Meter — Architecture

## Overview

Meter is a postpaid, multi-model AI workspace for builders. It sits in the pre-execution layer — between human strategic thinking and AI coding agents. Its primary technical job is to route intelligence, structure adversarial debates between models, log decisions as persistent records, and commit agent-ready artifacts to GitHub.

---

## Core Architecture Principles

1. **Intelligence is a utility.** Route it like compute, meter it like bandwidth, log it like code.
2. **Decisions are first-class objects.** Not chat transcripts. Timestamped, searchable, versioned records.
3. **The handoff is sacred.** Every artifact Meter generates must be immediately consumable by a coding agent without further interpretation.
4. **Private by default.** End-to-end encrypted. Open source core. Self-hostable.

---

## Tech Stack

### Frontend
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS
- **Auth:** NextAuth.js / Auth.js
- **State:** React Query + Zustand

### Backend
- **Runtime:** Node.js / Next.js API routes
- **Database:** PostgreSQL (primary store for decisions, debates, artifacts)
- **ORM:** Prisma
- **Queue:** Redis + BullMQ (for async debate orchestration)
- **Storage:** S3-compatible (for artifact file storage)

### AI Layer
- **Model Routing:** Custom router that selects optimal model based on task type, cost, and rate limit state
- **Models:** OpenAI (GPT-4o, o1), Anthropic (Claude 3.5 Sonnet, Claude 3 Opus), Google (Gemini 1.5 Pro), Grok, DeepSeek, Llama (via Groq/Together)
- **Debate Orchestration:** Custom adversarial prompt framework — models are assigned positions and forced to attack each other's logic, not just respond to the user
- **Billing:** Token counting per request, aggregated to postpaid invoice via Stripe

### GitHub Integration
- **Type:** GitHub App (NOT OAuth App)
- **Permissions:** Repository contents (Read & Write), Metadata (Read-only)
- **Token type:** Short-lived installation access tokens (1 hour expiry)
- **Commit behavior:** Meter commits Agent Spec Kit files directly to user-selected repos

### Connectors
- **Gmail:** Google OAuth (read scope only) — grounds strategy debates in real email context
- **Mercury:** Mercury API — surfaces real burn rate and runway in Banker mode
- **Stripe:** Stripe API — surfaces real revenue in Banker mode
- **Linear:** Linear API — syncs decisions to issues in Planner mode

---

## Core Data Models

### Decision
```
Decision {
  id: uuid
  title: string
  context: string
  choice: string
  reasoning: string
  alternatives: string[]
  createdAt: timestamp
  updatedAt: timestamp
  userId: uuid
  projectId: uuid
  debateId: uuid? (optional, if born from a debate)
  isAnonymized: boolean (for future Altimeter/community layer)
}
```

### Debate
```
Debate {
  id: uuid
  question: string
  models: string[] (e.g. ['claude', 'gpt4o', 'gemini'])
  rounds: DebateRound[]
  consensus: string
  tradeoffs: string[]
  winnerId: string (model that argued the winning position)
  decisionId: uuid? (linked Decision if user locked it in)
  createdAt: timestamp
  userId: uuid
}
```

### Artifact
```
Artifact {
  id: uuid
  type: enum (ARCHITECTURE | DECISIONS | CURSORRULES | CLAUDE | README | DESIGN)
  content: string (markdown)
  commitSha: string? (if pushed to GitHub)
  repo: string? (owner/name format)
  createdAt: timestamp
  userId: uuid
  projectId: uuid
}
```

---

## Agent Spec Kit (GitHub Handoff)

When a user triggers the handoff, Meter generates and commits the following files to their selected GitHub repo:

| File | Purpose |
|------|---------|
| `README.md` | Project overview, purpose, how to run |
| `ARCHITECTURE.md` | Tech stack, schema, core flows |
| `DESIGN.md` | Product philosophy and design decisions |
| `DECISIONS.md` | All locked decisions as ADRs |
| `CLAUDE.md` | Agent instructions optimized for Claude Code |
| `.cursorrules` | Agent instructions optimized for Cursor |

---

## Three Agent Modes

### Planner Mode
- **Connectors:** Gmail, Linear, Calendar
- **Capabilities:** Strategy debates, decision logging, follow-up tracking, artifact generation
- **Output:** Decision records, debate transcripts, Agent Spec Kit

### Coder Mode
- **Connectors:** GitHub, Vercel, Porkbun
- **Capabilities:** Repo management, branch creation, deploy triggers, domain registration
- **Output:** GitHub commits, PRs, live deploy URLs

### Banker Mode
- **Connectors:** Stripe, Mercury, Puzzle, Gusto
- **Capabilities:** Runway calculation, burn analysis, revenue trend, spend review
- **Output:** Financial summaries grounded in real data, not hallucinated projections

---

## Billing Architecture

- **Model:** Postpaid, pay-per-thought (token-based)
- **No flat fees.** No subscriptions. No idle seat charges.
- **Hard wallet caps** configurable per user — guaranteed never to overspend
- **Receipt:** Full, transparent itemized log of every token consumed, by model, by conversation
- **Invoicing:** Monthly via Stripe

---

## Security

- End-to-end encryption for all decision records and debate transcripts
- GitHub App tokens expire after 1 hour (installation access tokens)
- No model provider sees user data beyond the current request
- Open source core — auditable by anyone
- Self-hostable for enterprise users

---

## Future: Altimeter (Community Intelligence Layer)

An opt-in, anonymized community decision database. When a user finalizes a decision, they can choose to share it anonymously. Meter strips all identifying information (company name, revenue figures, team names) and stores only the structural skeleton: question asked, options debated, option chosen, top reasons why.

Over time this creates a compounding community intelligence layer. New users debating "Postgres vs. Supabase" see that 847 founders ran this debate before them and 72% landed on Supabase for projects under a certain scale.

Name: **Altimeter** (measures elevation — how high the community has climbed on a given decision).
