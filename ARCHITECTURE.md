# Meter — Architecture

## Overview

Meter is the billing engine for AI. It is two products:

1. **Meter SDK** (`getmeter.dev`) — an open-source SDK that lets any developer add multi-model AI chat with real-time usage-based billing to their app. One install. Model routing, live cost meter, per-message receipts, end-user card collection, auto-charge. The developer sets their markup. Meter takes 10%. The SDK is the company.

2. **Meter Chat** (`meter.chat`) — a pay-per-thought AI workspace for builders. Git for thinking. Debate AI models against each other, lock decisions, commit strategy artifacts to GitHub. Built entirely on the Meter SDK. Serves as the live demo and flagship product.

**Positioning:** Build on Meter. Pay per thought.

**Primary surface:** `getmeter.dev` (developer platform)
**Flagship app:** `meter.chat` (consumer product, live SDK demo)
**Auth:** Shared Keypass SSO across both domains

---

## Core Architecture Principles

1. **Intelligence is a utility.** Route it like compute, meter it like bandwidth, bill it like usage.
2. **The SDK is the product. The chat is the proof.** Every architectural decision optimizes for SDK adoption first.
3. **Decisions are first-class objects.** Not chat transcripts. Timestamped, searchable, versioned records. (meter.chat exclusive)
4. **The handoff is sacred.** Every artifact Meter generates must be immediately consumable by a coding agent without further interpretation. (meter.chat exclusive)
5. **Two money pools, never mixed.** Developer prepaid wallet (covers COGS) and end-user charges (generates revenue) are completely separate flows.

---

## Tech Stack

### Frontend
- **Framework:** Next.js (App Router)
- **Styling:** Tailwind CSS
- **Auth:** Keypass (universal passkey identity + subscription wallet)
- **State:** React Query + Zustand

### Backend
- **Runtime:** Node.js / Next.js API routes
- **Database:** PostgreSQL (decisions, debates, artifacts, billing ledger)
- **ORM:** Prisma
- **Queue:** Redis + BullMQ (async debate orchestration, billing aggregation)
- **Storage:** S3-compatible (artifact file storage)

### AI Layer
- **Model Routing:** Custom router selecting model based on task type, cost, and rate limit state
- **Models at launch:** Claude 4 Sonnet, Claude 4 Opus (Anthropic), GPT-5, GPT-4.1 (OpenAI), Gemini 2.5 Pro, Gemini 2.5 Flash (Google), Grok 4 (xAI)
- **Debate Orchestration:** Adversarial prompt framework — models assigned positions, forced to attack each other's logic (meter.chat exclusive)

### GitHub Integration
- **Type:** GitHub App (NOT OAuth App)
- **Permissions:** Repository contents (Read & Write), Metadata (Read-only)
- **Token type:** Short-lived installation access tokens (1 hour expiry)
- **Commit behavior:** Meter commits blueprint files directly to user-selected repos
- **Description language:** "Metered intelligence" (infrastructure language for app listings)

---

## SDK Architecture (`@meter/sdk`)

### What the SDK includes
- `MeterChat` — full drop-in chat component (default path)
- `ChatInput` — message input with model picker
- `MessageThread` — scrollable message list with streaming
- `MeterCounter` — live ticking cost meter (in-chat and header)
- `ReceiptBar` — cost/model/token summary per response
- `ModelPicker` — model selection dropdown
- `MeterHeader` — header dropdown with daily/lifetime totals, model breakdown, card management, transaction history
- `MeterProvider` — context wrapper handling auth, billing state, model routing, API communication
- Card collection modal — triggered on first use or after N free messages (configurable)
- Auto-charge logic — charges end user's card at $10 threshold

### What the SDK excludes (meter.chat exclusive)
- Debate mode (multi-model deliberation)
- Decision logging and commit flow
- Blueprint generation
- Slash commands (/money, /revenue, /users, /code)
- Inspector panel
- Git-for-thinking workflow
- Domain purchasing (Porkbun integration)

### Customization Model: Themed, Not Headless
The SDK ships with a polished default design. Developers customize through a theme object:

```typescript
<MeterChat
  appId="app_xxxxx"
  theme={{
    colors: {
      primary: '#6366f1',
      background: '#0a0a0a',
      text: '#fafafa',
      meter: '#22c55e',
    },
    radius: 'md',
    font: 'Inter',
    mode: 'dark',
    layout: 'compact', // or 'full'
  }}
  models={['claude-4-sonnet', 'gpt-5', 'gemini-2.5-pro']}
  freeMessages={3}
  onCharge={(amount) => console.log(`Charged: $${amount}`)}
/>
```

Core UX — meter animation, receipt data format, model picker interaction, billing flow — is locked and not customizable. The frontend is open source. The backend (routing, billing, ledger) is closed.

### Composable Primitives (Advanced Path)
```typescript
import {
  MeterProvider,
  MeterCounter,
  ModelPicker,
  ReceiptBar,
  MeterHeader,
  ChatInput,
  MessageThread,
} from '@meter/sdk'
```

All components must be wrapped in `MeterProvider`. Advanced developers can compose individual pieces into their existing UI.

---

## Financial Architecture

### Flow of Funds

**Two completely separate money pools:**

**Pool 1: Developer Prepaid Wallet (COGS)**
- Developer deposits $20 (minimum to start)
- Auto-Top-Up enabled by default: when balance falls below $5, charge developer's card $20
- When end users chat, raw AI token costs are deducted from this wallet to pay model providers
- Meter makes zero money from this pool — pure pass-through

**Pool 2: End-User Transactions (Revenue)**
- End user chats, meter ticks based on developer's markup
- At $10 threshold, Meter auto-charges end user's credit card
- Split: Stripe takes ~$0.59 (2.9% + $0.30) → Meter takes $1.00 (10% platform fee) → Developer receives $8.41
- Developer's net profit: $8.41 revenue minus raw token cost from Pool 1

**Example with 5x markup:**
- Raw AI tokens consumed: $2.00 (deducted from developer wallet)
- End user's meter reaches: $10.00 (5x markup)
- Stripe processing: $0.59
- Meter platform fee (10%): $1.00
- Developer payout: $8.41
- Developer net profit: $6.41

**Pricing:** 10% platform fee + standard Stripe processing fees (passed through, not absorbed)

### Why $10 Threshold
- Dilutes Stripe's fixed $0.30 fee (effective rate ~5.9% vs ~9% at $5)
- Below consumer "sticker shock" radar
- Maximum loss on declined card: $10
- Fast developer cash flow cycle

### The Moat
The SDK frontend is open source. The backend is the moat:
- **Micropayment Ledger:** Tracks fractions of a cent, aggregates to $10 threshold, handles edge cases and double-billing prevention
- **Model Router:** Manages API keys for all providers, fallback logic, token cost calculation across 7+ models
- **Payment Vault:** Secure card tokenization via Stripe, failed payment handling, expired card management, chargeback processing
- Forking the SDK without the backend requires 3-6 months of infrastructure engineering

---

## Core Data Models

### Decision (meter.chat exclusive)
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
  debateId: uuid? (if born from a debate)
}
```

### Debate (meter.chat exclusive)
```
Debate {
  id: uuid
  question: string
  models: string[]
  rounds: DebateRound[]
  consensus: string
  tradeoffs: string[]
  winnerId: string
  decisionId: uuid? (linked Decision if user committed)
  createdAt: timestamp
  userId: uuid
}
```

### Artifact (meter.chat exclusive)
```
Artifact {
  id: uuid
  type: enum (ARCHITECTURE | DECISIONS | CURSORRULES | CLAUDE | README | DESIGN | BRAND)
  content: string (markdown)
  commitSha: string?
  repo: string?
  createdAt: timestamp
  userId: uuid
  projectId: uuid
}
```

### BillingLedger (SDK core)
```
BillingLedger {
  id: uuid
  developerId: uuid
  endUserId: uuid
  model: string
  tokensIn: integer
  tokensOut: integer
  rawCost: decimal (what the model provider charges)
  billedCost: decimal (what the end user sees, with markup)
  chargeId: string? (Stripe charge ID when threshold hit)
  createdAt: timestamp
}
```

### DeveloperWallet (SDK core)
```
DeveloperWallet {
  id: uuid
  developerId: uuid
  balance: decimal
  autoTopUpEnabled: boolean (default: true)
  autoTopUpThreshold: decimal (default: 5.00)
  autoTopUpAmount: decimal (default: 20.00)
  stripeCustomerId: string
  createdAt: timestamp
  updatedAt: timestamp
}
```

### EndUserAccount (SDK core)
```
EndUserAccount {
  id: uuid
  developerId: uuid
  externalUserId: string (developer's user ID)
  stripeCustomerId: string
  pendingBalance: decimal (accumulated usage not yet charged)
  chargeThreshold: decimal (default: 10.00)
  totalSpend: decimal
  createdAt: timestamp
}
```

---

## Commit Flow (meter.chat exclusive)

### Interaction Model: Explicit Staging
1. During chat, Meter identifies decision points and asks "Want me to lock this in?"
2. User confirms → decision is staged
3. Commit button in header shows badge with count of uncommitted decisions
4. Click opens dropdown showing strategy diff: list of blueprint files that changed
5. Each item expandable for preview
6. Pre-filled commit message at bottom
7. Commit pushes all regenerated blueprint files as single GitHub commit

### Blueprint Files (Agent Spec Kit)
| File | Purpose |
|------|---------|
| `README.md` | Project overview, purpose, current phase, how to run |
| `ARCHITECTURE.md` | Tech stack, schema, core flows |
| `DESIGN.md` | Product philosophy and design decisions |
| `DECISIONS.md` | All locked decisions as ADRs |
| `CLAUDE.md` | Agent instructions for Claude Code / Codex |
| `.cursorrules` | Agent instructions for Cursor |
| `BRAND.md` | Brand voice, tone, visual identity, naming |

---

## Commands (meter.chat exclusive)

Connectors and slash commands are unified under one concept: **Commands**. Adding a connector gives you a command.

| Command | Connector | What it surfaces |
|---------|-----------|-----------------|
| `/money` | Mercury | Runway, balances, burn rate |
| `/revenue` | Stripe | MRR, customers, churn |
| `/users` | PostHog | DAUs, retention, funnels |
| `/code` | GitHub | Repos, PRs, recent commits |

Commands are named by intent, not by connector. This keeps them stable if underlying services change and supports multi-source commands in the future.

---

## Domain Purchasing (meter.chat exclusive)

- **Model:** Meter as reseller, user as registrant
- **Registrar:** Porkbun (dedicated Meter platform account: domains@getmeter.dev)
- **Flow:** User finds domain in chat → Meter's Porkbun account registers with user's contact info as WHOIS registrant → billed through Stripe via pendingCharges flow
- **Ownership:** Domain is legally the user's from day one (WHOIS shows their info)
- **No transfer needed.** User can create own Porkbun account and associate via registrant email
- **This pattern is the template for all future integrations:** Meter provisions on behalf of user, bills through existing flow, user owns the asset

---

## Site Architecture

### getmeter.dev (Developer Platform)
```
getmeter.dev/              → landing page, SDK pitch, pricing
getmeter.dev/docs          → SDK documentation
getmeter.dev/dashboard     → developer console, API keys, usage, credits
getmeter.dev/pricing       → pricing page (10% + Stripe fees)
```

### meter.chat (Flagship App / Live Demo)
```
meter.chat/                → landing page / chat interface
meter.chat/blueprints      → committed artifacts, full page, shareable
meter.chat/blueprints/:id  → single artifact, editable, shareable URL
meter.chat/decisions       → decision log, filterable, searchable
meter.chat/billing         → usage history, card management
```

meter.chat links to getmeter.dev via "Built with Meter SDK" / "Add to your app."
getmeter.dev links to meter.chat via "Try it live."

---

## Analytics
- **Platform:** PostHog (unified analytics, session recording, event tracking)
- **Key events:** OAuth signup, card added, first chat, first debate, first commit, SDK install, developer wallet funded, end-user first charge

---

## Security
- End-to-end encryption for all decision records and debate transcripts
- GitHub App tokens expire after 1 hour
- No model provider sees user data beyond the current request
- SDK frontend: open source, auditable
- SDK backend (routing, billing, ledger): closed source
- Dedicated Porkbun account for domain operations (never mixed with personal accounts)

---

## Future: Altimeter (Community Intelligence Layer)

Opt-in, anonymized community decision database. Users share decisions anonymously. Meter strips identifying information and stores only the structural skeleton. Over time, new users debating common questions see aggregate community data.

## Future: SDK Bolt-On Integrations

The domain purchasing pattern (Meter provisions, user owns, billed through SDK) extends to future integrations:
- Supabase provisioning
- Resend email setup
- Vercel deployment
- Custom domain management

Each becomes an optional SDK module developers can enable for their users.
