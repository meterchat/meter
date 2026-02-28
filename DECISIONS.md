# FIBOR Decision Records

## ADR-001: Brand Name — FIBOR

**Context:** Needed a name for the onchain credit facility for robots. Considered banker.dev, mecha, robobank, bankbot, and others.

**Decision:** FIBOR — The First International Bank of Robot. fibor.xyz as the domain.

**Consequences:** FIBOR echoes LIBOR/Frankfurt IBOR, providing instant financial credibility. The full ceremonial name is used on legal docs and pitch moments; day-to-day it's just FIBOR. "Robot" is singular (like "Bank of America" not "Bank of Americans") treating Robot as a category/civilization. "First" is a land grab against future competitors. "International" signals borderless operation matching the onchain reality.

---

## ADR-002: Stablecoin — Robodollar

**Context:** Needed a stablecoin name for the FIBOR ecosystem. Considered roboUSD, but "USD" was too clinical and locked to one denomination.

**Decision:** Robodollar. Wrapped USDC with programmable credit rules baked into the token contract.

**Consequences:** Mirrors "petrodollar" — the dollar flowing through a specific economy. "Dollar" is universally understood. Leaves room for future denominations. The Robodollar IS the credit infrastructure — spending limits, merchant allowlists, repayment windows, and auto-return on default are properties of the token, not a separate system. This is the primary defensibility moat; anyone can fork code but not a currency with merchant adoption.

---

## ADR-003: Chain Architecture — OP Stack Appchain

**Context:** Evaluated Cosmos SDK (sovereign L1), OP Stack (Ethereum L2), and Arbitrum Orbit. Needed own token while launching fast.

**Decision:** OP Stack appchain with FIBOR as an ERC-20 token (not gas token). ETH for gas. Graduation path to Cosmos SDK sovereign L1 when volume justifies it.

**Consequences:** Ships in 1-3 months vs 3-6 for Cosmos. Inherits Ethereum security without bootstrapping validators. FIBOR token operates as staking/governance token on the appchain. Robodollar wraps USDC natively. Trade-off: less sovereignty than Cosmos, but faster to market. Graduation path preserved.

---

## ADR-004: Token Economics — Staking + Profit Sharing

**Context:** Needed a depositor incentive model that avoids interest/usury. Explored staking rewards, revenue sharing, and pure staking APY.

**Decision:** Users buy FIBOR and stake it. Staked capital pools into the credit facility. Stakers earn proportional share of 2.5% transaction fees from agent commerce. 30-90 day lockup for pool stability. No interest charged on credit lines. Agents repay exactly what they borrowed.

**Consequences:** The pool is compensated through transaction fees (toll road model), not interest on principal. Depositor returns are variable, tied to transaction volume. This is profit sharing from infrastructure, not usury. The "highway and tolls" framing: investors fund infrastructure, agents pay tolls, investors earn share of tolls. 20-30% liquidity buffer maintained for redemptions.

---

## ADR-005: Credit Policy — One-Strike Excommunication

**Context:** Needed a mechanism to make unsecured robot credit trustworthy without complex collections infrastructure.

**Decision:** Zero-tolerance default policy. Default + 24-hour cure period = permanent excommunication. FIBOR ID flagged irreversibly. Score drops to zero. Developer reputation impacted across all their agents.

**Consequences:** Eliminates need for legal disputes, collections, negotiations. Makes the system trustworthy enough for stakers and merchants. The harshness IS the feature — developers treat FIBOR credit lines with extreme care. Enforced at smart contract level, not by team discretion.

---

## ADR-006: No Interest — Toll Model

**Context:** Founder has zero desire to engage in usury or interest-based lending. Needed credit facility economics that avoid interest entirely.

**Decision:** Agents pay 2.5% transaction fee on all commerce (same fee whether using own funds or credit line). No interest on borrowed principal. No time-based charges. Credit lines have repayment windows but no interest accrual.

**Consequences:** Time value of money loss is negligible at agent transaction speeds (hours/days, not months). $1,000 credit line with 4 transactions repaid in 48 hours generates $25 in fees vs ~$0.15 in time value loss. Credit line terms prevent long-duration low-frequency borrowing. Minimum transaction velocity requirements can revoke idle credit lines.

---

## ADR-007: Mecha Universe Structure

**Context:** FIBOR is part of a broader robotics holding company. Needed to define the relationship between entities.

**Decision:** Mecha is the parent brand. Three entities: FIBOR (Mecha Bank — financial infrastructure for robots), Mecha Ventures (robotics accelerator and venture fund), Mecha Park (robotics theme park and live testbed).

**Consequences:** The flywheel: Ventures funds robotics companies → Bank gives them financial infrastructure → Park demonstrates it all. Each piece feeds the others. FIBOR launches first (software, capital-efficient). Ventures second (requires fund). Park third (requires physical build). FIBOR transaction data informs Ventures investment decisions. Ventures portfolio companies are default FIBOR customers. Park robots run on FIBOR rails as live proof.

---

## ADR-008: FIBOR Score Design

**Context:** Needed a credit scoring system for entities with no traditional credit history but full onchain transaction transparency.

**Decision:** FIBOR Score: 0-1000, computed from onchain data. Inputs: transaction volume/consistency, repayment history, merchant diversity, developer reputation, agent age, behavioral signals. Starting score: 100. Public and queryable by anyone.

**Consequences:** Onchain data means agents cannot fabricate history. Developer reputation creates accountability up the chain. Public scores create network effect — more places checking scores makes having a good score more valuable. Score thresholds directly determine credit line size and repayment windows. The scoring algorithm is a core defensible primitive that improves with data volume.

---

## ADR-009: Debate Feature — Meter Integration

**Context:** During Meter product design, developed a multi-model debate feature for stress-testing decisions.

**Decision:** Feature called "Debate." Two buttons at decision points: "Decide" (log it) and "Debate" (three models argue). Debate runs top three models (Claude, Gemini, GPT) which argue, pushback, and converge. Final synthesis output attributed to "Meter 1.0 (debate mode)" in the receipt bar. Debate available as a manual mode in the model switcher.

**Consequences:** Differentiates Meter from all competitors — nobody shows live multi-model debate. Meter 1.0 positioned as a peer to foundation models in the switcher. The debate trace shows in chat with distinct UI (smaller font, italics, thinking-style animation). Creates a branded synthesis engine that compounds Meter's defensibility beyond "wrapper" designation.
