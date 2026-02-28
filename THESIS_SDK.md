# Meter — Thesis

## The Billing Layer for AI

Intelligence is a utility. It should be metered like compute, not sold like software.

Every week, thousands of builders ship AI apps with Cursor, Claude Code, and Lovable. They can generate a full-stack product in a weekend. But on Monday, they face the same unsolved problem: how do I charge my users for AI?

They can't use subscriptions — power users drain margins, light users churn. They can't build usage-based billing from scratch — metering tokens across multiple models, handling micropayments, collecting cards, reconciling ledgers. That's months of infrastructure work for a solo builder who just wants to ship.

So they either slap on a flat $10/month and lose money on every heavy user, or they keep the app free and eat the API costs until they quit.

Meter fixes this.

## What Meter Is

Meter is postpaid billing for AI. One open source SDK that adds multi-model chat with per-thought billing to any app in minutes. Your users pay per thought, not per month.

The developer installs the SDK, passes their authenticated user ID as a prop, and they're done. Meter handles model routing across every frontier model — Claude, GPT, Grok, Gemini, DeepSeek, Llama — through a single API. Meter handles real-time cost calculation with per-message receipts. Meter handles card collection through an embedded Stripe form. Meter handles threshold-based auto-charging that aggregates pennies into dollars. Meter handles the entire billing lifecycle so the developer never writes a line of payments code.

Three lines of code. Monetized by lunch.

```jsx
<MeterProvider apiKey="mk_live_xxx">
  <MeterChat userId={session.user.id} />
</MeterProvider>
```

## How It Works

The developer already has users. They already have auth. Meter never touches it.

The SDK receives an already-authenticated user ID as a prop — the same way Stripe Elements receives a client secret. It doesn't care how the user logged in. It just needs to know who they are.

Behind the scenes, Meter maps the developer's API key plus the user ID to an internal record. Chat history, billing, spend limits — all managed on Meter's infrastructure. The developer never provisions a database, runs a migration, or manages session storage.

When the end user chats, the meter ticks. When they hit $10, the card is charged automatically. The developer sets their markup — 2x, 3x, 5x, whatever their market supports. Meter takes a percentage. Everyone earns.

The end user controls their own cost. Pick Claude Opus and spend $25 in a heavy session. Pick DeepSeek and spend $1 for the same conversation. The model picker is a self-serve pricing tier that requires zero configuration from the developer.

## The SDK Architecture

Two layers. Like Stripe.

**@meterxyz/sdk** — Headless. Pure API client. Works with any framework, any language, any architecture. The developer calls `meter.chat()` and gets back a response plus a cost. They build whatever UI they want. Full control.

**@meterxyz/react** — Embedded components. Pre-built chat UI, model picker, cost counter, card form. Drop-in. Fixed design, like Stripe Elements. Consistent, trustworthy, done. For developers who want to ship fast without designing a chat interface.

Want full control? Use headless. Want speed? Use embedded. Both converge on the same billing infrastructure.

## Why Not Just Build It Yourself?

You can hack together a chat box that calls OpenAI in a day. That's not what Meter does.

Meter does multi-model routing across seven providers with automatic fallback. Real-time cost calculation with per-message receipts. Credit card collection via embedded Stripe Elements. Threshold-based auto-charging with a micropayment ledger that aggregates pennies into dollars. Multi-tenant user resolution where one API key maps to thousands of end users without touching the developer's auth. Developer wallets with auto-top-up so the developer funds inference costs upfront and Meter draws down as their users chat.

You can build a chat box in a day. You cannot build billing infrastructure in a day. And every day you spend on billing is a day you're not building your product.

## The Economics

The developer sets their markup. A 3x markup on a model that costs $2 per session means the end user pays $6. The developer keeps the margin. Meter takes a percentage of gross volume.

The developer's only cost is funding their wallet. End users pay per thought. The developer earns the spread. Meter earns the take rate. The end user gets transparent, usage-based pricing with no wasted subscription months.

At scale: 200 developers, 500 paying end users each, $8/month average spend. That is $800,000 in monthly transaction volume flowing through Meter. Every app that embeds Meter is distribution Meter didn't pay for. Every end user is revenue Meter didn't acquire.

## Open Source

The SDK is open source. Developers read the code, trust the code, contribute to the code. Open source is distribution for developer tools. The client libraries, the React components, the documentation — all open.

The billing infrastructure — the ledger, the reconciliation engine, the model routing, the settlement system — is closed. This is the Stripe model. Open client, closed core. Developers get transparency where it matters. Meter retains defensibility where it matters.

## The Vision

AI is becoming the runtime for every application. Every app will have intelligence embedded. And every app with embedded intelligence needs a way to bill for it.

Subscriptions cannot solve this. A flat monthly fee for variable AI usage is a losing proposition for either the developer or the user. The developer either overcharges light users (who churn) or undercharges heavy users (who drain margins). Usage-based billing is the only model that scales fairly.

Meter is the infrastructure that makes usage-based AI billing trivial. We are building the billing layer for the AI economy — the same way Stripe built the billing layer for the internet economy.

Every app. Every model. One meter. Pay per thought.
