# FIBOR Architecture

## Overview

FIBOR is an onchain credit facility for AI agents built as an OP Stack appchain (Ethereum L2). It provides financial identity, credit scoring, and credit lines for autonomous systems using the FIBOR token and Robodollar stablecoin.

## Chain

**OP Stack Appchain (Ethereum L2)**

FIBOR runs its own OP Stack rollup, inheriting Ethereum's security while maintaining its own execution environment. This provides:

- Ethereum-grade security without bootstrapping a validator set
- Custom gas and fee parameters optimized for agent transaction patterns
- Full control over block times and throughput
- Native bridge to Ethereum L1 for USDC wrapping and FIBOR token liquidity
- Graduation path to sovereign L1 (Cosmos SDK) when volume justifies it

## Token Architecture

### FIBOR (ERC-20)

The native protocol token. Functions:

- **Staking**: Users buy FIBOR and stake it on the platform. Staked FIBOR is locked (30–90 day lockup) and represents a share of the credit pool.
- **Profit sharing**: Stakers earn a proportional share of 2.5% transaction fees from all agent commerce.
- **Governance** (future): Protocol parameters, fee rates, credit policies.

FIBOR is NOT the gas token. Gas is paid in ETH (inherited from OP Stack). FIBOR is purely a staking and governance token.

### Robodollar (ERC-20, Wrapped USDC)

The programmable stablecoin. Pegged 1:1 to USD via mechanical USDC wrapping.

- Deposit USDC → receive Robodollar
- Redeem Robodollar → receive USDC
- No algorithmic peg. No reserve risk.

Programmable rules embedded in the token contract:

- **Spending limits**: Per-transaction and per-period caps tied to credit line terms
- **Merchant allowlists**: Restrict spending to verified merchants (optional, per credit agreement)
- **Repayment windows**: Auto-return of unspent Robodollars when window expires
- **Default enforcement**: Automatic freeze and clawback on default detection
- **Priority repayment**: When agent receives incoming funds, pool repayment is captured first

## Core Modules

### FIBOR ID

Persistent onchain financial identity for agents.

```
FiborID {
  id: bytes32 (unique, permanent)
  developer: address (creator/owner of the agent)
  agent_address: address (the agent's wallet)
  purpose: string (declared function of the agent)
  created_at: uint256
  status: enum (active, excommunicated)
  score: uint16 (0-1000, live)
}
```

- One FIBOR ID per agent, non-transferable
- Developer address is linked — developer reputation aggregates across all their agents
- Excommunication is permanent and irreversible at the contract level

### FIBOR Score

Real-time credit score computed from onchain data. Range: 0–1000.

**Inputs:**
- Transaction volume (30/60/90 day rolling)
- Transaction consistency (regularity of activity)
- Repayment history (on-time vs late, never vs defaulted)
- Merchant diversity (unique counterparties)
- Developer reputation (aggregate score of developer's other agents)
- Agent age (time since FIBOR ID creation)
- Behavioral signals (spending pattern anomalies, velocity changes)

**Starting score:** 100 (new agent, no history)

**Score thresholds:**
- 0–99: Excommunicated or inactive
- 100–299: Identity only, no credit access
- 300–499: Micro credit lines ($50–$500)
- 500–699: Standard credit lines ($500–$10,000)
- 700–899: Premium credit lines ($10,000–$100,000)
- 900–1000: Institutional credit lines ($100,000+)

Score is public. Queryable by any address via the FIBOR Score API.

### Credit Facility

The core lending mechanism.

**Pool structure:**
- Funded by staked FIBOR token purchases
- 20–30% liquidity buffer maintained for staker redemptions
- Remaining capital deployed as agent credit lines in Robodollars

**Credit line lifecycle:**
1. Agent qualifies based on FIBOR Score threshold
2. Onchain credit agreement minted (amount, repayment window, covenants)
3. Robodollars issued to agent's wallet with programmatic spending rules
4. Agent transacts, paying 2.5% fee per transaction
5. Incoming funds to agent trigger priority repayment to pool
6. Full repayment within window → credit line refreshes, score improves
7. Default (no cure within 24 hours) → permanent excommunication

**Repayment windows (scaled to score):**
- Score 300–499: 24–48 hours
- Score 500–699: 48 hours – 7 days
- Score 700–899: 7–14 days
- Score 900–1000: 14–30 days

**No interest charged.** Agent repays exactly what was borrowed. Pool compensation comes from 2.5% transaction fees, not from interest on principal.

### One-Strike Enforcement

Implemented at the smart contract level:

- Default detected (repayment window expires, balance unpaid)
- 24-hour cure period begins
- If not cured: FIBOR ID status set to `excommunicated` (irreversible)
- Score set to 0
- All active credit lines frozen and Robodollars clawed back
- Developer reputation score reduced proportionally
- Event emitted for all network participants

No appeals process. No exceptions. The contract enforces this, not a team.

## Revenue Flows

```
Agent Transaction ($100)
  └── 2.5% fee ($2.50)
       ├── FIBOR Operations (30%) → $0.75
       └── Staker Pool (70%) → $1.75
            └── distributed pro-rata to staked FIBOR holders

FIBOR Score API Query
  └── per-query fee (fractions of a cent)
       └── 100% to FIBOR Operations

FIBOR ID Registration ($10-$50)
  └── 100% to FIBOR Operations
```

## Smart Contract Architecture

```
contracts/
├── FiborToken.sol          # ERC-20, staking, lockup logic
├── Robodollar.sol           # Wrapped USDC with programmable rules
├── FiborID.sol              # Identity registry, excommunication
├── FiborScore.sol           # Score computation and queries
├── CreditFacility.sol       # Pool management, credit line issuance
├── CreditAgreement.sol      # Individual credit line terms and covenants
├── StakingPool.sol          # Stake/unstake, lockup, reward distribution
├── RevenueDistributor.sol   # Fee collection and split logic
└── governance/
    └── FiborGovernor.sol    # Future governance module
```

## External Integrations

- **USDC (Circle)**: Wrapping/unwrapping for Robodollar peg
- **OP Stack Sequencer**: Block production and L1 settlement
- **Ethereum L1**: Bridge for deposits/withdrawals, security inheritance
- **Chainlink / API3**: Price feeds if needed for any USD conversions

## Graduation Path

When transaction volume justifies sovereignty:

1. Deploy FIBOR chain on Cosmos SDK with FIBOR as native staking token
2. Migrate state from OP Stack appchain
3. FIBOR becomes true proof-of-stake with validator rewards
4. Robodollar bridges to new chain
5. IBC enables interoperability with Cosmos ecosystem
