# Meter — Decisions (ADRs)

This document contains the current locked decisions for Meter, formatted as lightweight Architecture Decision Records (ADRs).

---

## ADR-0001: Use a GitHub App (not an OAuth App) for GitHub integration

Context: Meter needs to commit decision artifacts (e.g., `ARCHITECTURE.md`, `.cursorrules`) to user-selected repos with minimal permissions and strong security.

Decision: Implement GitHub integration using a GitHub App with installation access tokens.

Consequences: Fine-grained repo selection and permissions, short-lived tokens, scalable rate limits, and built-in webhooks. OAuth scopes like `repo` are avoided because they are overly broad and long-lived.

---

## ADR-0002: Keep the primary navigation tab named “Decisions” (not “Strategy”)

Context: The core primitive in Meter is the decision record; pinned items and artifacts are downstream of decisions. “Strategy” is vague.

Decision: Keep the tab name as “Decisions” and improve hierarchy inside the tab if needed.

Consequences: Stronger conceptual alignment with the product thesis; clearer IA; less “Notion-like” ambiguity.

---

## ADR-0003: Keep the Thesis as a manifesto (avoid defensive IDE feature comparisons)

Context: Adding lines like “Cursor Plan Mode isn’t enough” turns the thesis into a comparison page and makes it feel dated.

Decision: Keep the thesis timeless; handle “Plan Mode” pushback in FAQ/objection handling.

Consequences: Thesis stays declarative and durable; objections are handled elsewhere.

---

## ADR-0004: Lock the final Meter Thesis copy (compressed manifesto)

Context: The thesis needed to be shorter while keeping the strongest ideas: pay-per-thought, structured debate, decision records, and GitHub handoff.

Decision: Use the finalized compressed thesis ending with “Think in Meter. Pay per thought.” with citations to MasteringAI and Digital Applied.

Consequences: Clear, punchy narrative for landing page and investor context; avoids feature list bloat.

---

## ADR-0005: Lock the Pushback FAQ as the official objection-handling doc

Context: Meter will face predictable dismissals (Cursor Plan Mode, “AI wrapper,” pay-per-use anxiety).

Decision: Use the following exact one-line answers as canonical responses:

1. “I already use Cursor's Plan Mode.” Cursor plans your code while Meter plans your strategy.
2. “Why wouldn't I just use ChatGPT to brainstorm strategy?” Because GPT can't give you an objective second opinion.
3. “Pay-per-thought sounds expensive” You only pay for what you use.
4. “I get anxiety seeing a pricing meter go up.” Absolute transparency and caps guarantee you never overspend.
5. “Debate mode sounds like a gimmick, won't most models just agree.” Meter's custom debate mode forces the models to ruthlessly attack each other's logic.
6. “Why do I need to push docs to GitHub?” Coding agents hallucinate wildly without explicit architectural guardrails.
7. “I can just copy and paste between models manually.” Manual copy-pasting permanently fractures your context window.
8. “This is just an AI wrapper.” Your compounding history of strategic decisions forms an uncopyable context moat.
9. “Vibecoders don't write architecture docs.” Building without architecture guarantees you will spend weeks fixing data models later.
10. “If I'm not writing code in Meter, why do I need it?” A brilliant codebase built on a broken decision is still a broken product.

Consequences: Consistent messaging across social, sales, and onboarding.

---

## ADR-0006: Canonical one-liner product description for intros

Context: Needed a single sentence that communicates what Meter is, what’s different, and what’s defensible without jargon or using “your.”

Decision: Canonical one-liner:

“I’m building Meter, a pay-per-thought AI for builders that gets different models to debate each other on strategy and create a permanent record of key decisions.”

Consequences: Standardized pitch line for DMs, investor intros, and social.

---

## ADR-0007: Messaging hierarchy — tagline vs. description

Context: “Think like you code” is a strong tagline but needs a concrete follow-up description.

Decision: Use “Meter is the first AI that lets builders think like they code.” as a tagline; use the canonical one-liner as the follow-up description.

Consequences: Clean hero/subhero structure; avoids overloading a single sentence.

---

## ADR-0008: Do not lead with “metered intelligence” in branding

Context: “Metered” can imply throttling, scarcity, and anxiety.

Decision: Prefer “pay-per-thought” (marketing) and “pay-as-you-go AI / on-demand AI” (technical listings) over “metered intelligence.”

Consequences: Less negative framing; clearer value proposition.

---

## ADR-0009: Agent modes are Planner / Coder / Banker

Context: “Tracks” mapped to departments rather than intent. Needed clear permission boundaries for connectors and crisp user mental models.

Decision: Use three modes: Planner, Coder, Banker. Each mode gates connectors and produces concrete artifacts.

Consequences: Clear UX, safer connector permissioning, and easier onboarding.

---

## ADR-0010: Future community intelligence layer via anonymized decision templates (Altimeter)

Context: A public decision repository like GitHub would leak sensitive strategy. But opt-in anonymized “decision skeletons” could create a compounding community intelligence flywheel.

Decision: Build a future opt-in anonymized decision template layer that aggregates outcomes and reasons without revealing sensitive details. Working name: Altimeter.

Consequences: Network effects without privacy violations; adds strong differentiation and retention.
