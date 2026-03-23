# Meter Pricing — Consumer Model

## One-Line Summary

Users pay per thought, postpaid. No subscription. No credits. Card auto-charged when balance reaches the settlement threshold.

---

## How Billing Works

### The Postpaid Model

1. User creates an account (passkey auth)
2. Adds a card on file (Stripe — supports Apple Pay / Google Pay)
3. Chats with any model — meter ticks per token
4. Card is auto-charged when pending balance reaches the threshold
5. If charge succeeds: balance resets, user keeps chatting
6. If charge fails: `settlement_failed` flag set, access pauses until payment method updated

### Markup

Meter applies a configurable markup multiplier to wholesale model costs.

```
Default markup:  2.0x (100% over wholesale)
Minimum charge:  $0.50 (Stripe minimum)
```

The markup multiplier is set globally via `app_config` and can be overridden per-user via `meter_users.markup_multiplier`.

---

## Auto-Settlement

A daily cron job (`/api/cron/settle-all`) runs at midnight UTC and settles all workspaces with ≥$10 in unsettled messages.

Users can also manually settle at any time via the UI.

### Exposure Caps (Trust Scaling)

| Stage | Max Unsettled Balance | Trigger |
|-------|----------------------|---------|
| New user | $20 | Default |
| After 2 successful settlements | $100 | Automatic |
| After 3+ successful settlements | $250 | Automatic |

---

## Spend Limits

Users can configure per-workspace limits:

| Limit | Scope | Enforced |
|-------|-------|----------|
| `daily_limit` | Per workspace per day | Pre-checked before each chat request (returns 429) |
| `monthly_limit` | Per workspace per month | Pre-checked before each chat request (returns 429) |
| `per_txn_limit` | Per message | Enforced client-side during streaming |

---

## Per-Token Pricing (at 2.0x markup)

Based on actual models in `src/lib/models.ts`:

| Model | Input / 1M tokens | Output / 1M tokens | Cost Badge |
|-------|-------------------|--------------------| -----------|
| Claude Sonnet 4.6 | $6.00 | $30.00 | $$ |
| Claude Opus 4.6 | $10.00 | $50.00 | $$$ |
| GPT-5.4 | $5.00 | $30.00 | $$ |
| Gemini 3.1 Pro | $4.00 | $24.00 | $$ |
| Grok 4.1 Fast | $0.40 | $1.00 | $ |
| DeepSeek V3 | $0.54 | $2.20 | $ |
| Meter 1.0 (Debate) | $6.00 | $30.00 | $$ |
| Meter 1.0 (Dissect) | $10.00 | $50.00 | $$$ |

### Cost Per Thought (estimated ~2K input + ~1K output tokens)

| Model | Per Thought (with markup) |
|-------|--------------------------|
| Grok 4.1 Fast | ~$0.001 |
| DeepSeek V3 | ~$0.003 |
| GPT-5.4 | ~$0.04 |
| Claude Sonnet 4.6 | ~$0.04 |
| Gemini 3.1 Pro | ~$0.03 |
| Claude Opus 4.6 | ~$0.07 |

### Cache-Aware Cost Formula

```
uncachedInput = tokensIn - cacheCreationTokens - cacheReadTokens
inputCost = (uncachedInput × inputPrice) +
            (cacheCreationTokens × inputPrice × 1.25) +
            (cacheReadTokens × inputPrice × cacheReadRate)
totalCost = (inputCost + tokensOut × outputPrice) × markupMultiplier
```

Cache read rates: Anthropic/Gemini/DeepSeek = 0.1x, OpenAI = 0.5x.

---

## Settlement Flow

1. Cron identifies workspaces with unsettled messages totaling ≥$10
2. Groups messages by workspace
3. Fetches user's Stripe customer ID and default payment method
4. Creates Stripe PaymentIntent for the total amount
5. On success: marks messages as `settled`, records in `settlement_history`, logs `payment_succeeded` event
6. On failure: sets `settlement_failed` on workspace, logs `payment_failed` event

---

## Developer SDK (v1 API)

Meter also exposes a public API for developers to embed metered AI in their own apps:

- `POST /api/v1/chat` — Streaming chat (API key auth)
- `GET /api/v1/sessions` — List sessions
- `GET /api/v1/history` — Usage history
- `POST /api/v1/billing/setup` — Setup end-user billing
- `GET /api/v1/billing/status` — Check billing status

API keys are managed in the developer console at `/console`.

---

## Pricing Principles

1. **No fixed fees.** Pure usage-based. Aligned incentives.
2. **No per-seat pricing.** AI usage is per-thought, not per-person.
3. **Transparent to users.** The meter ticks. Users see what they spend. This is the product.
4. **Spend limits protect users.** Daily, monthly, and per-transaction caps guarantee no surprise bills.
5. **Auto-settlement is predictable.** Small, frequent charges rather than large monthly invoices.
