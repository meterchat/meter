<p align="center">
  <img src="public/logo-dark-copy.webp" alt="Meter" width="140" />
</p>

<h3 align="center">Pay Per Thought</h3>

<p align="center">
  Real-time metered AI. Use first, pay after. Every token counted, every cent billed to your card.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://nextjs.org"><img src="https://img.shields.io/badge/Next.js-15-black?logo=next.js" alt="Next.js 15" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
  <a href="https://stripe.com"><img src="https://img.shields.io/badge/Stripe-Billing-purple?logo=stripe&logoColor=white" alt="Stripe" /></a>
</p>

<p align="center">
  <a href="https://meterchat.com">Live App</a> &nbsp;&middot;&nbsp;
  <a href="https://meterchat.com/docs">Documentation</a> &nbsp;&middot;&nbsp;
  <a href="https://x.com/meterchat">Twitter</a>
</p>

---

## What is Meter?

Meter is a **pay-per-use AI interface** that meters every token in real time and bills your card postpaid. No subscriptions, no credits, no prepayment — you use first and pay after.

A live cost ticker runs as the AI responds. Each message shows the model used, dollar cost, confidence score, and settlement status. Sign up with email, add a card, and start chatting. Billing happens at $10 or monthly, whichever comes first.

## How It Works

```
┌──────────────┐     ┌─────────────┐     ┌──────────────┐
│   Browser    │     │   Server    │     │   Stripe     │
│              │     │             │     │              │
│  Sign up     │────▶│  Create     │     │              │
│  (email)     │     │  account    │     │              │
│              │     │             │     │              │
│  Add card    │────▶│             │────▶│  Auth hold   │
│  ($0.00)     │     │             │     │  (verify)    │
│              │     │             │     │              │
│  Send        │────▶│  Stream AI  │     │              │
│  message     │◀─sse│ (OpenRouter)│     │              │
│              │     │             │     │              │
│  Meter       │     │  Report     │     │              │
│  ticks...    │◀────│  usage      │     │              │
│              │     │             │     │              │
│  $10 or      │     │  Charge     │────▶│  Bill card   │
│  month end   │     │  customer   │     │              │
└──────────────┘     └─────────────┘     └──────────────┘
```

1. **Sign up** — Enter your email to create an account
2. **Add card** — Card is verified with a no-charge authorization hold
3. **Chat** — Messages stream in chat, and the daily meter ticks in real time
4. **Settle** — Each message is marked settled with model, cost, and confidence score
5. **Bill** — Your saved card is charged on a recurring basis for only what you consumed

## Features

- **Real-time cost metering** — Watch your daily spend tick up token by token as the AI streams
- **Postpaid billing** — Use first, pay after. Card charged at $10 threshold or monthly
- **Per-message transparency** — Every response shows model, cost, confidence %, and settlement status
- **Daily meter** — Header shows today's spend with per-model breakdown, resets at midnight
- **Multi-model** — Claude Sonnet 4, Opus 4, GPT-4.1, Gemini 2.5 Pro, DeepSeek V3 via OpenRouter
- **Developer Console** — Generate API keys, monitor usage, manage billing
- **Developer API** — Integrate metered AI into your own apps with a single API key
- **Confidence scoring** — Each response includes an AI confidence estimate
- **Spending cap** — Set a daily spending limit ($1–$100) for cost control

## Design Decisions

- Stripe for billing. Industry-standard card processing. Auth hold on signup verifies the card without charging. Postpaid billing at $10 threshold or monthly sweep.
- Postpaid model. No prepayment, no credits, no wallet funding. Use first, pay after. Removes all friction from getting started.
- Per-message metering. Every response tracked individually with model, token counts, dollar cost, and confidence score. Full transparency on every interaction.
- Daily meter with midnight reset. Users see exactly what they're spending today. Per-model breakdown in the header dropdown. Spending cap for cost control.
- OpenRouter for models. One integration, every frontier model. Published per-token pricing with a small Meter markup.
- Email-first auth. Simple email signup. No wallets, no browser extensions, no seed phrases. Card on file is the only requirement.
- Fully open source (MIT). Auditable code. Users can verify, fork, or self-host.

## Architecture

```
src/
├── app/
│   ├── page.tsx                  # Main app (auth gating → chat)
│   ├── console/page.tsx          # Developer console (API keys, usage)
│   ├── docs/page.tsx             # Documentation
│   └── api/
│       ├── chat/route.ts         # SSE streaming via OpenRouter + confidence
│       └── v1/
│           ├── chat/route.ts     # Public API: metered chat
│           ├── keys/route.ts     # API key management
│           └── usage/route.ts    # Usage tracking
├── components/
│   ├── login-screen.tsx          # Email signup screen
│   ├── authorize-screen.tsx      # Stripe card auth hold
│   ├── chat-view.tsx             # Chat UI with message footer + daily meter
│   ├── inspector.tsx             # Right drawer (Usage / Billing / Settings)
│   ├── meter-pill.tsx            # Daily $ counter in header
│   ├── meter-icon.tsx            # Animated meter icon (sprite sheet)
│   └── model-picker.tsx          # Model selection dropdown
└── lib/
    ├── store.ts                  # Zustand state (auth, messages, daily metering)
    └── models.ts                 # Model definitions and pricing
```

### Stack

| Layer | Technology |
|-------|-----------|
| Framework | [Next.js 15](https://nextjs.org) (App Router, Turbopack) |
| Language | [TypeScript 5](https://typescriptlang.org) |
| Styling | [Tailwind CSS 4](https://tailwindcss.com) |
| State | [Zustand](https://zustand-demo.pmnd.rs) |
| Auth | Email signup |
| Billing | [Stripe](https://stripe.com) (card auth hold + postpaid) |
| AI Models | [OpenRouter](https://openrouter.ai) (Claude, GPT-4.1, Gemini, DeepSeek) |
| Database | [Supabase](https://supabase.com) (PostgreSQL) |
| UI | [Radix UI](https://radix-ui.com) + [shadcn/ui](https://ui.shadcn.com) |

## Quick Start

### Prerequisites

- Node.js 18+ or [Bun](https://bun.sh)
- [OpenRouter API key](https://openrouter.ai/keys)
- [Stripe API keys](https://dashboard.stripe.com/apikeys)
- [Supabase project](https://supabase.com)

### Install

```bash
git clone https://github.com/meterchat/meter.git
cd meter
cp .env.example .env.local
bun install
bun dev
```

### Environment Variables

```bash
# .env.local
OPENROUTER_API_KEY=sk-or-...                    # OpenRouter API key
STRIPE_SECRET_KEY=sk_...                        # Stripe secret key
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_...       # Stripe publishable key
NEXT_PUBLIC_SUPABASE_URL=https://...            # Supabase project URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=ey...             # Supabase anon key
SUPABASE_SERVICE_ROLE_KEY=ey...                 # Supabase service role key
```

Open [http://localhost:3000](http://localhost:3000), sign up with your email, add a card, and start chatting.

## API

Meter exposes a developer API for integrating metered AI into any application.

### `POST /api/v1/chat`

Stream an AI response with real-time token metering and confidence scoring.

```bash
curl -N https://meterchat.com/api/v1/chat \
  -H "Authorization: Bearer mk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "model": "anthropic/claude-sonnet-4"
  }'
```

**Response** (Server-Sent Events):

```
data: {"type":"delta","content":"Hello","tokensOut":1}
data: {"type":"usage","tokensIn":15,"tokensOut":42,"confidence":0.92}
data: {"type":"done"}
```

## Pricing

Pay-per-token with a small markup on OpenRouter base rates. Billed postpaid to your card at $10 or monthly.

| Model | Input (per 1M) | Output (per 1M) | ~Per Message |
|-------|----------------|-----------------|-------------|
| Claude Sonnet 4 | $3.00 | $15.00 | ~$0.008 |
| Claude Opus 4 | $15.00 | $75.00 | ~$0.04 |
| GPT-4.1 | $2.00 | $8.00 | ~$0.005 |
| Gemini 2.5 Pro | $1.25 | $10.00 | ~$0.005 |
| DeepSeek V3 | $0.30 | $0.88 | ~$0.0005 |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy and responsible disclosure process.

## License

MIT. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <a href="https://meterchat.com">meterchat.com</a>
</p>
