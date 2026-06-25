# Meter — Architecture

## Overview

Meter is a postpaid, multi-model AI workspace for builders. It sits in the pre-execution layer — between human strategic thinking and AI coding agents. Its primary technical job is to route intelligence across frontier models, structure adversarial debates, log decisions as persistent records, and commit agent-ready artifacts to GitHub.

---

## Core Architecture Principles

1. **Intelligence is a utility.** Route it like compute, meter it like bandwidth, log it like code.
2. **Decisions are first-class objects.** Not chat transcripts. Timestamped, searchable, versioned records.
3. **The handoff is sacred.** Every artifact Meter generates must be immediately consumable by a coding agent without further interpretation.

---

## Tech Stack

### Packages
- **`packages/cli`:** Meter CLI, the terminal-native execution handoff. It uses multi-model review, isolated worktrees, repo verification, repair, and local decision records.
- **`packages/sdk`:** Headless SDK surface for Meter API consumers.
- **`packages/react`:** Embeddable React components for Meter-powered chat and billing experiences.

### Frontend
- **Framework:** Next.js 15 (App Router, Turbopack)
- **Language:** TypeScript (strict mode)
- **Styling:** Tailwind CSS + Radix UI primitives
- **State:** Zustand (with localStorage persistence)
- **Animations:** Framer Motion
- **Auth UI:** SimpleWebAuthn (passkey-based, no passwords)
- **Payments UI:** Stripe Elements (Payment Element, Express Checkout)
- **Mobile:** Capacitor (iOS/Android shell)

### Backend
- **Runtime:** Node.js / Next.js API routes (serverless on Vercel)
- **Database:** Supabase (PostgreSQL) with Row-Level Security on all user data tables
- **Database Client:** Supabase JS SDK (service role key for server routes, anon key for client)
- **Auth:** WebAuthn passkeys via SimpleWebAuthn — no passwords, no OAuth login
- **Sessions:** Server-side session tokens stored in `auth_sessions` table

### AI Layer
- **Model Routing:** Multi-tier fallback system
  - Tier 1: Direct provider API keys (Anthropic, OpenAI, Google, xAI, DeepSeek)
  - Tier 2: OpenRouter (same model, fallback router)
  - Tier 3: AWS Bedrock (Claude models only)
  - Tier 4: Auto-route to alternate model if all tiers fail
- **Models:** Claude Opus 4.6, Claude Sonnet 4.6, GPT-5.4, Gemini 3.1 Pro, Grok 4.1 Fast, DeepSeek V3
- **Virtual Models:** Auto (Meter routing), Debate (multi-model), Dissect (multi-persona analysis)
- **Debate Orchestration:** 4-phase adversarial framework (Opening → Challenge → Vote → Synthesis) across 3 models from 3 independent labs
- **Dissection Engine:** 4-persona analytical framework (First Principles → Inversion → Pre-mortem → Verdict) using Claude Opus 4.6
- **Caching:** Prompt caching on system prompt + context (Anthropic/Gemini/DeepSeek = 0.1x read rate, OpenAI = 0.5x)
- **Billing:** Token counting per request with configurable markup multiplier (default 2.0x), aggregated to auto-settlement via Stripe

### GitHub Integration
- **Type:** GitHub App (NOT OAuth App)
- **Permissions:** Repository contents (Read & Write), Metadata (Read-only)
- **Token type:** Short-lived installation access tokens (1 hour expiry)
- **Commit behavior:** Meter commits Agent Spec Kit files directly to user-selected repos

---

## Core Data Models

### Decision (decisions table)
```
decisions {
  id: uuid
  user_id: text
  title: text
  status: text           -- 'undecided' | 'decided'
  archived: boolean
  choice: text           -- the final decision
  alternatives: jsonb    -- array of options considered
  reasoning: text
  session_id: text       -- workspace scope
  chat_message_id: text  -- linked message (if born from conversation)
  category: text
  parent_decision_id: uuid  -- for versioning (superseded decision)
  version: integer       -- increments on reopen
  revisit_count: integer
  created_at: timestamptz
  updated_at: timestamptz
}
```

### Chat Message (chat_messages table)
```
chat_messages {
  id: text
  session_id: text
  role: text             -- 'user' | 'assistant' | 'system'
  content: text
  model: text            -- model ID used
  tokens_in: integer
  tokens_out: integer
  cache_creation_tokens: integer
  cache_read_tokens: integer
  cache_read_rate: real  -- provider-specific discount
  cost: real             -- USD cost to user (after markup)
  confidence: real
  debate_trace: jsonb    -- full debate phases (if debate mode)
  dissector_trace: jsonb -- full dissection output (if dissect mode)
  documents: jsonb       -- artifact snapshots
  thinking: text         -- model reasoning trace
  settled: boolean
  pinned: boolean
  created_at: timestamptz
}
```

### Artifact (artifacts table)
```
artifacts {
  id: uuid
  user_id: text
  session_id: text       -- workspace scope
  file_path: text        -- e.g. 'README.md', 'ARCHITECTURE.md'
  content: text          -- markdown content
  status: text           -- 'draft' | 'synced'
  category: text         -- readme | architecture | design | decisions | claude | cursorrules
  github_repo: text      -- owner/name format
  github_sha: text       -- last committed SHA
  last_pushed_at: timestamptz
  created_at: timestamptz
  updated_at: timestamptz
}
```

### Workspace (chat_sessions table, is_subtrack = false)
```
chat_sessions {
  id: text
  user_id: text
  workspace_name: text
  is_subtrack: boolean   -- false = workspace, true = track/fork
  parent_session_id: text
  total_cost: real
  daily_limit: real
  monthly_limit: real
  per_txn_limit: real
  today_cost / week_cost / month_cost: real
  settlement_failed: boolean
  portal_slug: text      -- for public docs portal
  committed: boolean
  created_at: timestamptz
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

## Billing Architecture

- **Model:** Postpaid, pay-per-thought (token-based)
- **Markup:** Configurable multiplier on wholesale model costs (default 2.0x)
- **No flat fees.** No subscriptions. No idle seat charges.
- **Spend limits:** Configurable daily, monthly, and per-transaction caps per workspace
- **Auto-settlement:** Daily cron job settles workspaces with ≥$10 pending balance via Stripe
- **Exposure caps:** $20 (new user) → $100 (after 2 successful settlements) → $250 (after 3+)
- **Minimum charge:** $0.50 (Stripe minimum)
- **Receipt:** Per-message cost breakdown with model, tokens, cache stats, and settlement status

### Cost Calculation
```
uncachedInput = tokensIn - cacheCreationTokens - cacheReadTokens
inputCost = (uncachedInput × inputPrice) +
            (cacheCreationTokens × inputPrice × 1.25) +
            (cacheReadTokens × inputPrice × cacheReadRate)
totalCost = (inputCost + tokensOut × outputPrice) × markupMultiplier
```

---

## Security

- **Authentication:** WebAuthn passkeys (no passwords stored)
- **OAuth tokens:** Encrypted at rest with AES-256-GCM (12-byte IV, 16-byte auth tag)
- **Database:** Row-Level Security (RLS) enabled on all user data tables
- **GitHub App tokens:** Expire after 1 hour (installation access tokens)
- **No model provider sees user data** beyond the current request
- **Server-side secrets:** API keys and service role keys never exposed to client

---

## Future: Altimeter (Community Intelligence Layer)

An opt-in, anonymized community decision database. When a user finalizes a decision, they can choose to share it anonymously. Meter strips all identifying information (company name, revenue figures, team names) and stores only the structural skeleton: question asked, options debated, option chosen, top reasons why.

Over time this creates a compounding community intelligence layer. New users debating "Postgres vs. Supabase" see that 847 founders ran this debate before them and 72% landed on Supabase for projects under a certain scale.

Name: **Altimeter** (measures elevation — how high the community has climbed on a given decision).
