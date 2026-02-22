# Meter — Protocol Design Decisions

A living record of the architectural choices that define how Meter works under the hood. Each entry captures what we chose, why, and what we didn't choose.

---

## 1. Pay Per Thought

Meter bills per token, in real time. No subscriptions, no seat licenses, no credit packs. You use the AI, a cost ticker runs, and you pay for exactly what you consumed.

### Rationale

Subscriptions create misaligned incentives. Users either overpay (low usage months) or hit invisible ceilings (rate limits on "unlimited" plans). Per-token billing is the only model where the user's cost is proportional to the value they extract. It also means Meter never has to throttle power users or subsidize light ones — every message is self-funding.

The 2x markup on provider base rates is uniform across all models. No volume discounts, no tiered pricing, no promotional rates. This keeps the pricing model dead simple: pick any model, multiply the provider rate by two, that's what you pay.

### Alternatives considered

- **Monthly subscription with usage cap.** Standard SaaS playbook. Rejected because it forces artificial limits and creates the "will I hit my cap?" anxiety that kills exploration. The whole point of Meter is removing friction from AI usage.
- **Credit packs / prepaid balance.** Buy $50 of credits, spend them down. Rejected because prepaid creates sunk cost psychology and adds a refund surface. Credits also require a separate ledger, exchange rates if pricing changes, and expiration policies.
- **Freemium with upgrade.** Free tier with limited models, paid tier with full access. Rejected because a free tier attracts non-paying users who consume support and infrastructure without contributing revenue. Every Meter user is a paying user from message one.

### Counterpoints

The live cost ticker is counterintuitive — watching dollars increment in real time could throttle usage. Users who'd happily pay $20/month on a subscription might flinch at watching $0.03 tick up per message. The psychological cost of visible spend is real: every message feels like a micro-purchase decision, which could suppress the exploratory, open-ended usage that makes AI most valuable.

The bet is that transparency wins the long game. Every AI tool already charges per token — Cursor, Claude Code, Lovable — they just bury it behind subscriptions and opaque "fast request" quotas. Users discover the real cost eventually (rate limits, throttling, surprise overages) and feel deceived. Meter puts the number in your face from the start. Counterintuitive business models that expose what incumbents hide have won before: Airbnb showed you exactly what you'd pay (no resort fees, no minibar surprises) when hotels buried costs in fine print. The initial reaction was "strangers' homes feel sketchy" — but price transparency and honest listings built more trust than any hotel loyalty program. Meter makes the same bet: show the real number, and users who see it will trust you more than the ones who never knew what they were paying.

Transparency also unlocks interaction modes that subscriptions can't support. A $20/month subscription can't offer a $4 multi-model debate (§7) without blowing the unit economics. Pay-per-thought can, because the user sees the cost, chooses to spend it, and the math works for both sides.

---

## 2. Postpaid Settlement

Use first, pay after. Your card is charged when your outstanding balance hits the auto-settle threshold (default $25) or at the end of the month — whichever comes first. No prepayment, no holds, no authorization charges during usage.

### Rationale

Prepaid billing creates friction at the worst moment: when a user wants to start using the product. Postpaid removes that friction entirely. Add a card (verified via Stripe SetupIntent, no charge), start chatting immediately. The trust relationship is: Meter extends credit to you, and you pay when the balance accumulates.

Settlement is a single Stripe PaymentIntent with `confirm: true` and `off_session: true` — a merchant-initiated charge with no user interaction required. If 3D Secure is required by the card, the charge fails rather than interrupting the user's workflow. Failed settlements trigger the exposure cap system (see §5) rather than blocking the user immediately.

### Alternatives considered

- **Prepaid wallet.** Deposit funds, spend from balance. Rejected because it adds deposit UX, balance management, low-balance warnings, and refund complexity. It also creates a psychological barrier: users think twice before depositing, even if they'd happily pay the same amount postpaid.
- **Per-message charging.** Charge the card after every single message. Rejected because high-frequency micro-charges trigger fraud detection at card networks and create excessive Stripe fees (each PaymentIntent has a fixed cost component).
- **Invoice-based billing.** Send a monthly invoice, net-30 payment terms. Rejected because it requires accounts receivable infrastructure, collections processes, and credit checks. Works for enterprise, overkill for individual users.

### Counterpoints

Postpaid means Meter absorbs credit risk. A user could rack up $100 in usage and then have their card decline. The exposure cap system (§5) mitigates this by limiting outstanding balance based on payment history — new users are capped at $20 unsettled, rising to $250 after three successful settlements.

---

## 3. On-Chain Settlement Receipts

After every successful Stripe charge, Meter writes a settlement receipt to Base (Coinbase's Ethereum L2). The receipt is a self-send transaction with zero value — the payload is JSON-encoded in the transaction's calldata. No money moves on-chain; it's purely a notarization layer.

### Rationale

The receipt creates a tamper-proof, publicly auditable record that a specific settlement occurred at a specific time for a specific amount. Neither Meter nor the user can retroactively alter the record. This is useful for dispute resolution ("I was charged $X but Meter says $Y") and for building trust in a postpaid system where the billing is opaque.

Base was chosen because it's an L2 with sub-cent transaction costs, fast finality, and Coinbase backing. The payload format is a versioned JSON blob (`version: 1`) that includes the user ID, item breakdown, total amount, and timestamp.

### Alternatives considered

- **No receipts at all.** Just rely on Stripe's records. Rejected because Stripe records are only visible to Meter (the merchant), not to the user independently. On-chain receipts are user-verifiable without trusting Meter.
- **IPFS content-addressed receipts.** Pin a receipt JSON to IPFS, store the CID. Rejected because IPFS has no inherent timestamping or ordering, and content persistence depends on pinning services.
- **Full on-chain payment rail.** Accept crypto payments, settle on-chain. Rejected because it adds wallet UX complexity, volatile pricing, and regulatory burden. The on-chain layer is strictly for receipts, not payments.

### Counterpoints

On-chain receipts add gas cost per settlement (even on L2) and a dependency on Base RPC availability. If the RPC is down, settlement still succeeds (Stripe charge goes through) but the receipt is skipped. The mock mode (random hash when no private key is configured) means development and testing don't require a live chain.

---

## 4. Universal Chat Per Workspace

Each workspace has one continuous conversation thread. There are no "new chat" buttons, no conversation list, no chat history sidebar. You open a workspace and you're in the same conversation you left. The AI retains full context of everything discussed in that workspace.

### Rationale

Multi-chat interfaces fragment context. Users create dozens of throwaway chats, lose track of where decisions were made, and repeat themselves across conversations. A single thread per workspace means the AI always knows what was discussed before — previous decisions, established preferences, ongoing projects. It turns the AI from a stateless Q&A tool into a persistent collaborator.

Context management uses a 30,000-token sliding window. When the conversation exceeds this, older messages are trimmed from the front (most recent messages kept). The system prompt sits outside the token budget and is always included. This keeps costs predictable — a 30k context costs roughly $0.30 for Opus input at 2x markup.

### Alternatives considered

- **Traditional multi-chat.** ChatGPT-style sidebar with conversation list. Rejected because it encourages disposable conversations and fragments the user's knowledge graph across dozens of threads.
- **Automatic topic splitting.** AI detects topic changes and auto-creates new threads. Rejected because topic boundaries are subjective, and the system would frequently get them wrong. Better to let one thread accumulate and trim by recency.
- **Infinite context (no trimming).** Send the entire conversation history every time. Rejected because a 200k-token context costs $2.00 per message for Opus input alone. The 30k cap is a cost control measure, not a technical limitation.

### Counterpoints

A single thread means older context is eventually lost (trimmed beyond the 30k window). There's no summarization of dropped messages — they're simply gone from the AI's view. For long-running workspaces, this means the AI forgets early conversations. A future improvement could add summarization of trimmed context, but the current approach prioritizes simplicity and cost predictability over perfect recall.

---

## 5. Workspace Model

Workspaces are the unit of isolation in Meter. Each workspace has its own conversation thread, cost tracking, connected services, spend limits, and settlement history. New users create their first workspace during onboarding — there are no defaults. The onboarding flow is a single-page progression: enter email → sign passkey → name workspace → add card. Users can create additional workspaces after setup.

### Rationale

Different projects have different contexts, different connected services, and different budgets. A startup workspace might connect Stripe and Mercury for financial queries; a personal workspace might connect Gmail and GitHub. Workspace isolation means connecting Stripe to your startup project doesn't expose that data when you're chatting in your personal workspace.

Billing is tracked per-workspace (`todayCost`, `totalCost`, daily/monthly limits) but settled per-user (a single Stripe charge covers all workspaces). This gives granular visibility without fragmenting payment methods.

### Alternatives considered

- **Single global workspace.** One conversation, one set of connectors. Rejected because professional and personal contexts shouldn't bleed into each other, and different projects need different tool access.
- **Team workspaces with shared billing.** Multiple users share a workspace and split costs. Rejected for v1 — adds invitation flows, permission models, and split billing complexity. Single-user workspaces are the right starting point.
- **Per-workspace payment methods.** Each workspace has its own card. Rejected because most users have one card and don't want to manage multiple payment methods. The workspace is an organizational boundary, not a financial one.

### Counterpoints

The workspace model currently lacks a few things: no archiving (old workspaces persist forever), no workspace-level export, and no shared workspaces. The organizational hierarchy (Company > Project) exists in the database schema but isn't fully wired — projects within a workspace don't have separate cost tracking or their own chat sessions. This is scaffolding for future structure.

---

## 6. Exposure Caps (Trust-Tiered Credit)

When a settlement fails (card declined, auth required), Meter doesn't immediately block the user. Instead, it activates an exposure cap based on the user's payment history. New users get a $20 cap on unsettled balance. After 1-2 successful settlements: $100. After 3+: $250.

### Rationale

Hard-blocking on first settlement failure is hostile — cards decline for transient reasons (expired, bank hold, insufficient funds on a specific day). The trust-tiered system gives established users breathing room while limiting Meter's credit exposure to unproven accounts.

The cap only activates after a failed settlement. Users who have never had a settlement failure face no cap at all (beyond their own configured spend limits). This means the system is invisible to well-behaved users and only kicks in when there's a real credit risk signal.

### Alternatives considered

- **Immediate block on settlement failure.** Card declines → chat stops until payment is resolved. Rejected because it punishes users for transient card issues and creates a support burden.
- **Universal exposure cap for all users.** Everyone gets the same unsettled balance limit regardless of history. Rejected because it either limits power users unnecessarily (cap too low) or exposes Meter to risk from new users (cap too high).
- **Graduated rate limiting.** Instead of hard block at cap, slow down responses or limit to cheaper models. Rejected for complexity — binary on/off is easier to reason about and communicate to users.

### Counterpoints

The tiering is coarse (3 tiers). A user with 100 successful settlements gets the same $250 cap as one with 3. More granular tiers or a continuous function could better reward loyalty, but the simplicity of three buckets makes the system easy to explain and debug.

---

## 7. Meter 1.0 — Multi-Model Debate Protocol

Meter 1.0 is a structured debate between three frontier models (Opus 4.6, GPT-5.2, Grok 4.1 Fast) followed by a synthesis from Sonnet 4.6. Four fixed phases: Opening (state position), Cross-Examination (challenge others), Final Vote (pick a winner), Verdict (synthesize the winning argument).

### Rationale

Single-model responses have blind spots. Every model has failure modes — hallucination patterns, reasoning gaps, biases from training data. Running three models on the same question and forcing them to critique each other surfaces disagreements that a single model would silently gloss over. The forced convergence (vote + synthesis) ensures the user gets one clear answer, not three competing ones.

The synthesis is handled by Sonnet (not one of the debaters) to avoid self-bias. Models must reference each other by name and can concede if another model's argument is stronger. The protocol is fixed (no adaptive phases) because structured deliberation produces more reliable results than free-form multi-model chaos.

### Alternatives considered

- **Best-of-N sampling.** Run the same model N times, pick the best response. Rejected because it doesn't surface inter-model disagreements — the same model makes the same mistakes repeatedly.
- **Mixture of Experts routing.** Route different queries to different models based on strengths. Rejected because it requires a reliable classifier for query type, and the whole point of debate is that you don't know which model will be best until they argue.
- **Free-form multi-model panel.** All models respond independently, user picks the best. Rejected because it shifts cognitive load to the user. Meter 1.0 does the convergence work so the user gets one answer.
- **Iterative refinement.** Models critique and revise in multiple rounds until consensus. Rejected because it multiplies cost (each round is 3 API calls) with diminishing returns. One round of cross-examination captures most disagreements.

### Counterpoints

Meter 1.0 costs roughly 3-4x a single model (10 LLM calls per debate). The blended rate is $13.90/$79.00 per 1M tokens — expensive for routine questions. It's best reserved for high-stakes decisions where the cost of a wrong answer exceeds the cost of the debate. The fixed roster also means if one model degrades or a better model launches, the roster must be manually updated.

---

## 8. Three-Tier Provider Fallback

Every model request goes through a three-tier waterfall: Tier 1 (OpenRouter), Tier 2 (direct API with same model, silent), Tier 3 (auto-route to a different model, visible to user). The user is only notified on Tier 3 rerouting — Tier 2 failover is invisible.

### Rationale

No single provider has 100% uptime. OpenRouter is the primary because it offers a single API for all models with built-in caching support. But when OpenRouter is down (rate limited, 503, capacity issues), Meter falls back to direct API keys (Anthropic, OpenAI, xAI, Google, DeepSeek). If both the primary provider and its direct key fail, auto-route tries other models entirely — Sonnet first, then GPT, then Gemini.

Tier 2 is silent because the user asked for a specific model and got it — they don't need to know the routing layer changed. Tier 3 is visible because the user asked for model A and is getting model B — they deserve to know.

### Alternatives considered

- **Single provider (OpenRouter only).** Simpler, but a single point of failure. Rejected because even a few minutes of downtime during active usage is unacceptable.
- **Parallel racing.** Send the request to all providers simultaneously, return whichever responds first. Rejected because it multiplies cost (you pay for all attempts) and complicates token accounting.
- **User-configurable fallback chain.** Let users set their own fallback preferences. Rejected for v1 — most users don't want to think about provider routing. The fixed waterfall (Sonnet → GPT → Gemini) covers the most common failure scenarios.
- **Circuit breaker with health tracking.** Track provider failure rates and skip unhealthy providers. Rejected because provider health changes quickly (a 429 doesn't mean the next request will fail) and stale health data causes worse routing than a simple waterfall.

### Counterpoints

The waterfall is sequential (each tier is tried one at a time), which adds latency on failure. If Tier 1 times out (rather than failing fast), the user waits for the timeout before Tier 2 is attempted. There's also no retry-within-tier — a single failure at each tier triggers fallback rather than retry. For transient errors (network blips), a quick retry might resolve faster than falling to the next tier.

---

## 9. Passkey-Only Authentication

Meter uses WebAuthn passkeys (FIDO2) as the sole authentication method. No passwords, no magic links, no OAuth social login for user identity. Email is an identifier, not a verification channel. Sessions are 30-day server-side tokens in httpOnly cookies.

### Rationale

Passwords are a liability — they get reused, phished, leaked in breaches, and require reset flows. Passkeys eliminate all of these problems. The cryptographic key never leaves the user's device, can't be phished (bound to the relying party domain), and authentication is biometric or PIN-gated at the device level.

The `requireUserVerification: false` setting means Meter doesn't mandate biometric/PIN — it works even on devices without biometric sensors. This maximizes device compatibility at the cost of slightly weaker per-authentication assurance (the device attests presence, not identity).

### Alternatives considered

- **Email + password.** Universal but insecure. Rejected because it requires password hashing, reset flows, breach monitoring, and still gets phished.
- **Magic links (email OTP).** Send a login link to email. Rejected because it depends on email deliverability (spam filters, delays) and shifts security to the email provider. Also slow — user has to switch to email, click link, switch back.
- **OAuth social login (Google/GitHub).** Fast to implement, familiar UX. Rejected for user auth because it creates a dependency on third-party identity providers and leaks login events to Google/GitHub. OAuth is used for service connectors (Gmail, GitHub), not for Meter identity.

### Counterpoints

Passkeys are still unfamiliar to many users. Some users don't have devices that support passkeys, or don't understand the flow. There's no fallback auth method — if your passkey is lost and not backed up, you lose access. A future improvement could add recovery via email verification, but the current design prioritizes security purity over recovery convenience.

---

## 10. Tracks (Not Yet Implemented)

Tracks are sub-projects within a workspace. The database schema exists (`workspace_projects` table) and the client-side data model is defined (Company > Project hierarchy), but tracks don't yet drive any business logic — no separate chat threads, no per-track billing, no per-track connectors.

### Rationale

The organizational need is clear: a startup workspace might have separate tracks for "Product," "Fundraising," and "Hiring," each with different context and different AI usage patterns. Tracks would let users partition their workspace without creating entirely separate workspaces.

The infrastructure was built ahead of the feature to avoid schema migrations later. The `workspace_projects` table and `Project` interface are in place, ready to be wired to chat sessions and billing when the feature is built.

### Alternatives considered

- **Tags instead of tracks.** Tag messages with topics, filter by tag. Less structured than tracks but more flexible. Under consideration for a lighter-weight v1.
- **Nested workspaces.** Workspaces within workspaces. Rejected because it adds hierarchy complexity without clear benefit over a flat track model.

### Counterpoints

Building schema before the feature risks over-engineering — the data model might not match what users actually need once tracks ship. The current `Company > Project` hierarchy might be too rigid (why "Company"?) or too simple (what about sub-tracks?). This is a known risk accepted in favor of having the database ready.

---

## 11. Agent Virtual Wallet (Not Yet Implemented)

A future mechanism where each workspace (or agent) gets a virtual spending budget that draws from the user's card. The agent can autonomously spend up to its allocated budget without per-action approval.

### Rationale

As AI agents become more autonomous (multi-step tool chains, long-running tasks), per-action billing approval becomes a bottleneck. A virtual wallet lets the user say "this workspace can spend up to $50 on this task" and the agent operates within that budget autonomously. It's the financial equivalent of giving an employee a corporate card with a limit.

This builds naturally on the existing per-workspace cost tracking (`todayCost`, `totalCost`) and spend limits (`daily_limit`, `monthly_limit`) — the wallet would be an extension of these mechanisms with pre-allocated rather than post-hoc limits.

### Alternatives considered

- **Per-action approval.** User confirms each tool call or expensive operation. Rejected at scale because it turns autonomous agents into interactive assistants. The whole point of agents is unsupervised execution.
- **Global budget pool.** One budget across all workspaces/agents. Rejected because it doesn't let users allocate different trust levels to different tasks.

### Counterpoints

Virtual wallets add complexity: what happens when the wallet runs out mid-task? Does the agent pause, fail, or request more funds? How does the user top up a wallet without the prepaid psychology we rejected in §2? These design questions are why this feature isn't implemented yet.

---

## 12. Client-Side State Primacy

The browser (Zustand + localStorage) is the authoritative state store. The server is a persistence layer that syncs every 10 seconds via POST. On page load, client and server state are merged — client wins if it has messages, server wins if client is empty.

### Rationale

Client-side primacy means the app works offline, responds instantly (no round-trip for state reads), and survives server outages. The 10-second sync interval plus `sendBeacon` on page unload ensures data reaches the server without blocking the UI. Zustand's `persist` middleware handles localStorage serialization automatically.

The alternative — server-authoritative state with client cache — would require every state read to be async and every write to wait for server confirmation. For a real-time chat interface where the cost ticker updates multiple times per second, this latency is unacceptable.

### Alternatives considered

- **Server-authoritative with optimistic UI.** Write to server first, update UI optimistically. Rejected because it adds conflict resolution complexity and makes the app dependent on server availability for basic operations.
- **CRDTs for conflict-free sync.** Use conflict-free replicated data types for automatic merge. Rejected as over-engineered for a single-user application. CRDTs solve multi-writer conflicts; Meter has one writer (the user's browser).
- **Real-time sync (WebSocket).** Push state changes to server immediately via WebSocket. Rejected because it requires persistent connections, reconnection logic, and server-side state management that the polling approach avoids.

### Counterpoints

Client-side primacy means data can be lost if the browser crashes before sync. The 10-second interval means up to 10 seconds of messages could be lost. There's also no cross-device sync in real time — if you open Meter on two devices, the last one to sync wins. For a v1 single-user product, these tradeoffs are acceptable.

---

## 13. Per-Message Receipt Lifecycle

Every assistant message goes through a three-stage receipt lifecycle: `signing` (streaming in progress), `signed` (response complete, receipt generated with a hex signature), `settled` (Stripe charge succeeded, batch transaction hash attached). Each message carries its own cost, token counts, model attribution, and receipt status.

### Rationale

In a postpaid system, every dollar of unsettled balance is credit risk. Per-message receipts create an auditable trail from the moment tokens are generated to the moment they're paid for. The signature is generated at completion (not at settlement), so there's an immediate, tamper-evident record of what was consumed — even before the card is charged.

This also enables granular usage attribution. Users can see exactly which messages cost what, which model generated them, and whether they've been settled. The `settled: boolean` flag on each message is the primitive that drives the settlement system — `settleAll()` collects all messages where `settled === false` and charges them in one batch.

### Alternatives considered

- **Session-level billing only.** Track total cost per session, settle the aggregate. Rejected because it loses per-message attribution — users can't see which specific messages drove their costs.
- **Real cryptographic signatures (ECDSA/EdDSA).** Sign each receipt with a private key for non-repudiation. Currently the "signature" is a random hex string, not a real cryptographic signature. Real signing is a future consideration but adds key management complexity.
- **Server-side receipt generation.** Have the server generate and store receipts. Rejected because the client-side-first architecture means receipts need to exist locally before the server sync happens.

### Counterpoints

The current signatures are pseudo-random hex strings, not cryptographically meaningful. They provide visual consistency (every message has a "receipt") but don't actually prove anything. Moving to real ECDSA signatures would require a signing key per user and verification infrastructure — overkill for v1 but on the roadmap.

---

## 14. No Rate Limits

Meter imposes no request-per-minute or messages-per-hour rate limits. The only limits are cost-based: user-configured spend caps (daily/monthly per workspace) and the trust-tiered exposure cap after failed settlement. If you can pay for it, you can use it.

### Rationale

Rate limits exist in subscription products to prevent abuse of "unlimited" plans. In a per-token billing model, abuse is self-limiting — every message costs money. A user sending 1,000 messages per hour is paying for 1,000 messages per hour. There's no economic reason to throttle them.

The three-tier fallback system (§8) also means that provider-level rate limits (429s from OpenRouter or direct APIs) are absorbed by failover rather than surfaced to the user. If one provider is rate-limiting, Meter silently routes to the next one. The user's experience is uninterrupted.

### Alternatives considered

- **Per-minute request caps.** Standard API practice. Rejected because it solves an abuse problem that doesn't exist in a paid-per-token model.
- **Soft throttling (slow down responses).** Gradually increase response latency under heavy load. Rejected because it degrades experience without clear benefit — if the providers can handle the load, why slow down?
- **Queue-based fair scheduling.** Queue requests during peak load, process in order. Rejected because it adds infrastructure complexity (job queue, workers) for a problem that provider-level load balancing already handles.

### Counterpoints

No rate limits means a single user could theoretically consume disproportionate provider capacity during peak times. In practice, per-user volume is small relative to provider capacity, and the fallback system distributes load across multiple providers. If this becomes a real problem at scale, per-user request budgets could be added without changing the billing model.

---

## 15. Connectors as Tool Calls

External services (Gmail, GitHub, Stripe, Mercury, Ramp, Supabase, PostHog, Vercel) are wired as native LLM tool calls, not as standalone integrations with separate UI. The AI decides when to use them based on conversation context. Connection is per-workspace — different workspaces can have different services connected.

### Rationale

The AI should be the integration layer, not the UI. When a user says "check my latest Stripe payments," the AI calls `stripe_list_payments` as a tool — no separate Stripe dashboard, no tab switching. This keeps the interface unified: one conversation thread where the AI has access to everything the user has connected.

OAuth tokens are encrypted at rest (AES-256-GCM), scoped per-workspace, and auto-refreshed when expiring within 60 seconds. API-key connectors (Mercury, Ramp, Supabase, PostHog) use stored keys rather than OAuth flows. Tool execution is sequential within a round, with up to 5 tool rounds per user message (6 total LLM calls maximum).

### Alternatives considered

- **Standalone integration panels.** Separate UI for each connected service (inbox view, repo browser, etc.). Rejected because it fragments the user's attention and duplicates UI that each service already provides. The AI as integration layer means zero additional UI surface.
- **Zapier/Make-style automation.** Trigger-action workflows between services. Rejected because workflows are rigid and require upfront configuration. Natural language tool calling is more flexible — the user describes what they want, and the AI figures out which tools to chain.
- **MCP (Model Context Protocol).** Standardized tool protocol for AI-service integration. Under consideration for future connectors but not adopted yet — current connectors are custom-built for tighter control over auth, error handling, and response formatting.

### Counterpoints

Sequential tool execution (not parallel) adds latency when multiple tools are needed. The 5-round limit means complex multi-step workflows can hit the ceiling. There's also no tool approval flow — tools execute automatically, which means a misinterpreted user request could trigger unintended actions (e.g., creating a GitHub repo when the user was just asking about it). For read-only tools this is low-risk; for write operations (create repo, deploy), it's worth monitoring.

---

## 16. Decision Tracking as a Native Capability

Decision capture is a built-in AI tool (`save_decision`), not a separate feature. The AI detects decision points in conversation — when a user makes a choice, picks an approach, or commits to a direction — and prompts to log it. Decisions store the choice, alternatives considered, reasoning, and project context.

### Rationale

Decisions are the most valuable output of AI conversations, but they're the most likely to be lost. Users make a decision in chat, close the tab, and forget what was decided a week later. By making decision capture a tool the AI can invoke mid-conversation, the friction drops to zero — the user doesn't have to context-switch to a separate app or manually log anything.

The `[decision-point]` tag in the AI's system prompt triggers UI affordances (buttons to save or debate) when the AI senses a decision has been reached. This makes capture proactive rather than reactive — the AI suggests logging before the user forgets to.

### Alternatives considered

- **Separate decision journal app.** A standalone tool for logging decisions. Rejected because it requires the user to manually transcribe decisions from chat to journal — high friction, low adoption.
- **Automatic decision extraction.** AI retroactively scans conversation and extracts all decisions. Rejected because it's unreliable (false positives) and removes user agency over what counts as a "decision."
- **Inline annotations.** User highlights text and marks it as a decision. Rejected because it requires manual selection and doesn't capture context (alternatives, reasoning) that the AI can surface from the conversation.

### Counterpoints

The AI's judgment about what constitutes a "decision point" is imperfect. It may prompt on trivial choices (naming a variable) or miss significant ones (choosing a vendor). The `[decision-point]` detection is prompt-driven, not trained — it relies on the system prompt instructions rather than fine-tuned classification. Over-prompting could become annoying; under-prompting defeats the purpose.
