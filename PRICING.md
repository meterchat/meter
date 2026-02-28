# Meter Pricing Strategy — Developer SDK

## One-Line Summary

Developers prepay for credits. Their users pay per thought, postpaid. Meter takes 10% and never floats a dollar.

---

## Positioning

**Stripe for metered intelligence.**

Meter is billing infrastructure for AI-powered apps. Developers embed the Meter SDK to give their users access to top AI models with built-in metering, billing, and cost transparency — without building any of it themselves.

---

## Pricing Architecture

### The Three Players

| Player | What They Do | How They Pay |
|---|---|---|
| **Model Provider** (Anthropic, OpenAI, etc.) | Serves the intelligence | Paid by Meter from developer credits |
| **Developer** | Builds AI-powered app, sets retail markup | Prepays credits, earns from end users |
| **End User** | Uses the AI features in developer's app | Postpaid, auto-charged at $5 threshold |

### The Money Flow

```
Developer prepays credits → loads $100
End user sends message → meter ticks
Developer's credit balance debited (wholesale + 10%) → Meter pays model provider
End user accumulates usage → auto-charged at $5 → revenue flows to developer
Developer credits replenish from revenue → cycle continues
```

**Meter's cash position: always positive.** Credits are collected before API calls are made. Zero float. Zero credit risk. Self-sustaining from thought number one.

---

## Take Rate

```
Platform fee:    10% of wholesale API cost
Fixed fee:       $0
Monthly minimum: $0
```

### Why 10%

- **Floor (cost-based):** 2-3% covers infrastructure + payment processing. Below this Meter loses money.
- **Ceiling (value-based):** 20-25% is where large-volume developers seriously evaluate building in-house.
- **10% sits in the sweet spot:** High enough to build a real business. Low enough that no developer at any scale will route around you. The savings vs. building it yourself ($80-120K/year in eng costs) make the math undeniable.

### Why No Fixed Fee

Adding a monthly fee on top of 10% creates a mental model collision. The developer is thinking "I pay for what my users use" and then sees a $29/month platform fee. It undermines the entire usage-based positioning. If you want more revenue, increase the take rate to 11%. Don't bolt on a subscription.

---

## Developer Pricing (What Developers Pay Meter)

### Credit System

- Developer loads credits via card on file
- Credits denominated in USD, not tokens
- Each API call debits credits at: **wholesale model cost + 10%**
- Auto-replenish available: "When balance drops below $20, auto-charge $100"

### Cost Per Thought to Developer (wholesale + 10%)

Based on a typical message: ~2,000 input tokens + ~1,000 output tokens.

| Model | Wholesale/Thought | Developer Pays (+ 10%) |
|---|---|---|
| Claude 4 Sonnet | $0.021 | $0.0231 |
| GPT-4.1 | $0.012 | $0.0132 |
| Gemini 2.5 Pro | $0.015 | $0.0165 |
| Grok 3 | $0.021 | $0.0231 |
| Claude 3.5 Haiku | $0.0056 | $0.00616 |
| GPT-4.1 mini | $0.0024 | $0.00264 |
| Gemini 2.5 Flash | $0.002 | $0.0022 |

### What Happens When Credits Run Out

- Developer's users see: "This service is temporarily unavailable"
- Developer gets alert: "Your Meter balance is low. Add credits to keep your AI features running"
- Identical to how Twilio, SendGrid, and every usage-based API works
- Auto-replenish prevents this entirely

---

## End User Pricing (What End Users Pay Developers)

### The Postpaid Model

- Card on file required at signup
- No prepaid credits, no wallet, no top-up screen
- User chats, meter ticks, usage accumulates
- Auto-charge fires at $5 threshold
- If charge succeeds: limit resets, user keeps chatting, no interruption
- If charge fails: access pauses until payment method updated

### Trust Scaling

| Stage | Threshold | Trigger |
|---|---|---|
| New user | $5 | Default |
| After 3 successful charges | $10 | Automatic |
| After 10 successful charges | $25 | Automatic |
| After 3 months consistent usage | $50 | Automatic |
| Heavy user | $100+ | Manual review |

### Developer Controls

- Developer sets their own retail markup percentage (e.g., 30%, 50%, 100%)
- Developer can enable/disable specific models for their users
- Developer can set per-user spending caps
- Developer can override trust scaling thresholds

### Example End User Prices (at 50% developer markup)

| Model | Developer Cost | End User Pays | Developer Margin |
|---|---|---|---|
| Claude 4 Sonnet | $0.0231 | $0.035 | $0.012 |
| GPT-4.1 | $0.0132 | $0.020 | $0.007 |
| Gemini 2.5 Pro | $0.0165 | $0.025 | $0.008 |
| Claude 3.5 Haiku | $0.00616 | $0.009 | $0.003 |
| GPT-4.1 mini | $0.00264 | $0.004 | $0.001 |

---

## Curated Model Lineup (v1)

Seven models only. Four premium, three fast. Meter controls the list.

### Premium Tier
| Model | Why |
|---|---|
| Claude 4 Sonnet | Best overall reasoning, flagship |
| GPT-4.1 | OpenAI's best, developer favorite |
| Gemini 2.5 Pro | Google's best, strong long context |
| Grok 3 | xAI's best, differentiated personality |

### Fast Tier
| Model | Why |
|---|---|
| Claude 3.5 Haiku | Cheap, fast, reliable |
| GPT-4.1 mini | OpenAI budget option |
| Gemini 2.5 Flash | Google budget, very cheap |

### What's Excluded and Why

- **Claude 4 Opus:** $0.105/thought is 5x Sonnet. Users accidentally burning $0.10+ per message creates billing shock and support burden. Add only if demand proven.
- **DeepSeek models:** Regulatory and data routing concerns for US/EU developers. Revisit based on market.
- **All other models:** Curation is the product. 30+ models creates paradox of choice for end users and unpredictable cost profiles for developers.

### Model Rotation Policy

Meter reserves the right to add, remove, or replace models in the curated lineup. When a new model launches (e.g., GPT-5, Claude 5), Meter evaluates and adds it. When a model is deprecated or superseded, Meter removes it. Developers are notified 30 days before removal.

---

## Float Management

### The Core Principle

**Meter never floats a dollar.** Every API call is funded by developer prepaid credits before execution.

### Maximum Float Exposure

| Source | Amount | Duration |
|---|---|---|
| Developer credits (prepaid) | $0 float — already collected |
| End user charges (auto at $5) | Max $5/user until charge clears | 2-3 day Stripe settlement |
| **Total Meter float** | **$0** | **N/A** |

The only float in the system is between the developer and their end users — and that is the developer's risk, not Meter's. The developer has already prepaid for the credits consumed. End user revenue flowing back to the developer is a replenishment, not a float Meter depends on.

### Startup Capital Required

To launch Meter's own consumer product (meter.xyz):
- Pre-fund ~$500-$1,000 in model API credits
- End user auto-charges begin flowing back within hours of first usage
- Self-sustaining within days, not months

---

## Unit Economics Per Thought

### Meter's Margin (on a Claude 4 Sonnet thought)

| Line Item | Amount |
|---|---|
| Developer's credit balance debited | $0.0231 |
| Meter pays Anthropic (wholesale) | ($0.021) |
| **Meter gross profit per thought** | **$0.0021** |
| Meter margin on take | **91%** (negligible COGS on the fee itself) |

### Developer's Margin (at 50% markup to end user)

| Line Item | Amount |
|---|---|
| End user pays (retail) | $0.035 |
| Stripe processing (2.9%) | ($0.001) |
| Developer pays Meter | ($0.0231) |
| **Developer gross profit per thought** | **$0.0109** |
| Developer margin | **31%** |

### All Players Summary

| Player | Per Thought (Sonnet) | % of Retail |
|---|---|---|
| Model Provider (Anthropic) | $0.021 | 60% |
| Meter | $0.0021 | 6% |
| Developer | $0.0109 | 31% |
| Stripe | $0.001 | 3% |
| **End User Pays** | **$0.035** | **100%** |

---

## Revenue Projections

### Assumptions
- Weighted average wholesale cost per thought: $0.015
- Meter take: 10% = $0.0015/thought
- Average developer has 500 monthly active users
- Average user sends 100 thoughts/month

### Growth Scenarios

| Stage | Developers | Total Thoughts/Mo | Meter Revenue/Mo | Annual |
|---|---|---|---|---|
| Launch (Month 1-3) | 10 | 500K | $750 | $9K |
| Traction (Month 6) | 50 | 2.5M | $3,750 | $45K |
| Growth (Month 12) | 200 | 10M | $15,000 | $180K |
| Scale (Month 18) | 500 | 25M | $37,500 | $450K |
| Breakeven (Month 24) | 1,000 | 50M | $75,000 | $900K |
| Escape velocity | 2,500 | 125M | $187,500 | $2.25M |

### Breakeven Analysis

| Fixed Cost | Monthly |
|---|---|
| Team (3-4 people) | $40,000 |
| Infrastructure | $5,000 |
| Tools & services | $2,000 |
| **Total fixed costs** | **$47,000** |

**Breakeven at ~31M thoughts/month** (~620 developers with moderate usage). At $0.0015 per thought, that requires $47K / $0.0015 = ~31.3M thoughts.

---

## Competitive Pricing Comparison

| Platform | Model | Take Rate | What You Get |
|---|---|---|---|
| **Metronome (Stripe)** | Enterprise billing infra | Custom | Billing engine only, no UI, no routing, multi-week integration |
| **OpenRouter** | Model routing | ~5-15% markup | Routing only, no billing UI, no end-user metering |
| **Stripe Billing** | Usage-based billing | 0.7% of billing volume | Generic billing, no AI-specific features |
| **Build it yourself** | N/A | $80-120K/year eng cost | Full control, massive time investment |
| **Meter** | Full stack | 10% of wholesale | Model routing + billing + metering UI + receipt system + model picker |

### Meter's Advantage in One Line

OpenRouter gives developers model routing. Stripe gives developers billing. **Meter gives developers both, plus the entire consumer-facing metering UI, in one SDK install.**

---

## Pricing Principles (Non-Negotiable)

1. **Meter never floats.** Developer prepays. Always.
2. **No fixed fees.** Pure usage-based. Aligned incentives.
3. **No per-seat pricing.** AI usage is per-thought, not per-person.
4. **Curated models only.** 5-7 top models. Quality over quantity.
5. **Transparent to end users.** The meter ticks. Users see what they spend. This is the product.
6. **Developer controls markup.** Meter does not dictate retail price. Developer sets their margin.
7. **10% is the number.** Simple. Memorable. Defensible. Do not add tiers, addons, or complexity.

---

## The Pitch

### To Developers
> "Add metered AI to your app in an afternoon. Load credits like any API. Your users pay per thought with the meter UI built in. You set your markup. Revenue flows back automatically. You keep 90 cents of every dollar."

### To End Users
> "Pay for what you think. Not a subscription. Not a token bundle. Just a meter that ticks while you think."

### To Investors
> "Meter is Stripe for metered intelligence. 10% of every AI interaction on our platform. Developers prepay, users postpaid, we never float. Zero-capital scaling."
