<p align="center">
  <img src="apps/web/public/logo-dark-copy.webp" alt="Meter" width="140" />
</p>

<h3 align="center">Add metered AI to any app</h3>

<p align="center">
  One SDK for model routing, usage tracking, and postpaid billing.<br />
  Ship AI features in an afternoon.
</p>

<p align="center">
  <a href="https://opensource.org/licenses/MIT"><img src="https://img.shields.io/badge/License-MIT-blue.svg" alt="License: MIT" /></a>
  <a href="https://www.npmjs.com/package/@getmeter/sdk"><img src="https://img.shields.io/badge/npm-@getmeter/sdk-orange" alt="npm" /></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-5-blue?logo=typescript&logoColor=white" alt="TypeScript" /></a>
</p>

<p align="center">
  <a href="https://getmeter.dev/docs">Docs</a> &nbsp;&middot;&nbsp;
  <a href="https://meter.chat">Live Demo</a> &nbsp;&middot;&nbsp;
  <a href="https://getmeter.dev/console">Console</a> &nbsp;&middot;&nbsp;
  <a href="https://github.com/meterdev/meter">GitHub</a>
</p>

---

## What is Meter?

Meter is **metered AI infrastructure for developers**. Integrate AI into your app with one SDK — Meter handles model routing (Claude, GPT, Gemini, Grok, DeepSeek), per-token usage tracking, and postpaid billing via Stripe. Your users pay for what they use. You never touch billing code.

## Quick Start

### Option A: React (drop-in UI)

```bash
npm install @getmeter/react
```

```tsx
import { MeterProvider, MeterChat } from "@getmeter/react";

function App() {
  return (
    <MeterProvider apiKey="mk_your_api_key">
      <MeterChat userId="user_123" showModelPicker showCostCounter />
    </MeterProvider>
  );
}
```

### Option B: SDK (headless)

```bash
npm install @getmeter/sdk
```

```typescript
import { MeterClient } from "@getmeter/sdk";

const meter = new MeterClient({ apiKey: "mk_your_api_key" });

const stream = await meter.chat({
  messages: [{ role: "user", content: "Hello" }],
  model: "anthropic/claude-sonnet-4.6",
  endUserId: "user_123",
});

for await (const event of stream) {
  if (event.type === "delta") process.stdout.write(event.content);
}
```

### Option C: REST API

```bash
curl -N https://getmeter.dev/api/v1/chat \
  -H "Authorization: Bearer mk_..." \
  -H "Content-Type: application/json" \
  -d '{
    "messages": [{"role": "user", "content": "Hello"}],
    "model": "anthropic/claude-sonnet-4.6",
    "endUserId": "user_123"
  }'
```

## How It Works

1. **Install** — `npm install @getmeter/sdk` (or `@getmeter/react` for React)
2. **Get an API key** — Sign up at [getmeter.dev/console](https://getmeter.dev/console)
3. **Integrate** — Pass your API key and your user's ID. Meter handles everything else.
4. **Billing** — End users add a card. Usage is tracked per-token. Cards charged at $10 or monthly.

## Packages

| Package | Description |
|---------|------------|
| [`@getmeter/sdk`](packages/sdk) | Core TypeScript client — chat, sessions, history, billing |
| [`@getmeter/react`](packages/react) | Drop-in React components — `<MeterChat />`, `<MeterProvider />` |
| [`@getmeter/web`](apps/web) | meter.chat — reference implementation and live demo |

## API Reference

### `POST /api/v1/chat` — Stream AI response

```
Authorization: Bearer mk_your_api_key
Content-Type: application/json

{ "messages": [...], "model": "...", "endUserId": "..." }

→ SSE stream:
data: {"type":"delta","content":"Hi","tokensOut":1}
data: {"type":"usage","tokensIn":5,"tokensOut":50}
data: {"type":"done"}
```

### Other endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| `GET` | `/api/v1/sessions?endUserId=` | List sessions |
| `POST` | `/api/v1/sessions` | Create session |
| `GET` | `/api/v1/history?endUserId=&sessionId=` | Get message history |
| `GET` | `/api/v1/billing/status?endUserId=` | Check billing status |
| `POST` | `/api/v1/billing/setup` | Create Stripe SetupIntent |
| `GET` | `/api/v1/keys` | Manage API keys |
| `GET` | `/api/v1/usage` | Get usage stats |

## Models

All models available through one endpoint. Pay-per-token with 2x markup on provider rates.

| Model | Provider | Input / 1M | Output / 1M |
|-------|----------|-----------|-------------|
| Claude Sonnet 4.6 | Anthropic | $6.00 | $30.00 |
| Claude Opus 4.6 | Anthropic | $10.00 | $50.00 |
| GPT-5.2 | OpenAI | $3.50 | $28.00 |
| Gemini 3.1 Pro | Google | $4.00 | $24.00 |
| Grok 4.1 Fast | xAI | $0.40 | $1.00 |
| DeepSeek V3 | DeepSeek | $0.54 | $2.20 |

## Repo Structure

```
meterdev/meter
├── packages/
│   ├── sdk/          # @getmeter/sdk — core TypeScript client
│   └── react/        # @getmeter/react — React components
├── apps/
│   └── web/          # meter.chat — reference implementation
├── README.md
├── LICENSE
├── CONTRIBUTING.md
└── SECURITY.md
```

## Development

```bash
git clone https://github.com/meterdev/meter.git
cd meter

# Run the reference app
cd apps/web
cp .env.example .env.local
bun install
bun dev
```

See [apps/web/.env.example](apps/web/.env.example) for required environment variables.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md) for guidelines.

## Security

See [SECURITY.md](SECURITY.md) for our security policy and responsible disclosure process.

## License

MIT. See [LICENSE](LICENSE) for details.

---

<p align="center">
  <a href="https://getmeter.dev">getmeter.dev</a>
</p>
