# CLAUDE.md — Agent Instructions for FIBOR

## Project

FIBOR — The First International Bank of Robot. An onchain credit facility for AI agents. Built on OP Stack (Ethereum L2).

## Stack

- Solidity smart contracts (Foundry toolchain)
- OP Stack appchain configuration
- ERC-20: FIBOR token (staking + governance)
- ERC-20: Robodollar (wrapped USDC with programmable credit rules)
- Custom: FIBOR ID registry, FIBOR Score engine, Credit Facility

## Key Contracts

```
contracts/
├── FiborToken.sol          # ERC-20, staking with 30-90 day lockup
├── Robodollar.sol           # Wrapped USDC, programmable spending rules
├── FiborID.sol              # Agent identity registry, permanent excommunication
├── FiborScore.sol           # Credit scoring (0-1000) from onchain data
├── CreditFacility.sol       # Pool management, credit line issuance
├── CreditAgreement.sol      # Per-agent credit terms and covenants
├── StakingPool.sol          # Stake/unstake, lockup enforcement, reward distribution
├── RevenueDistributor.sol   # 2.5% fee collection, 30/70 split (ops/stakers)
└── governance/
    └── FiborGovernor.sol    # Future governance
```

## Critical Rules

1. NO INTEREST. Agents never pay interest. The 2.5% transaction fee is flat, universal, and identical for prepaid and credit-line transactions.

2. ONE-STRIKE DEFAULT. Excommunication is permanent and irreversible. The `excommunicate()` function sets status to a terminal state with no admin override. Do not add appeal mechanisms, grace extensions, or admin rescue functions.

3. ROBODOLLAR RULES ARE IN THE TOKEN. Spending limits, repayment windows, merchant allowlists, and auto-return logic live in Robodollar.sol, not in a separate monitoring contract. The token enforces its own constraints.

4. SCORE IS PUBLIC. FiborScore is readable by any address. No access control on score queries. Permissionless reads.

5. DEVELOPER REPUTATION. Every FiborID links to a developer address. Score computation must factor in aggregate behavior of all agents under the same developer.

6. LIQUIDITY BUFFER. StakingPool must maintain 20-30% of total deposits as unlocked liquidity for redemptions. Credit facility can only deploy from the remaining 70-80%.

7. PRIORITY REPAYMENT. When an agent with an active credit line receives incoming funds, the CreditAgreement captures repayment before the agent can spend.

## Fee Structure

- 2.5% on every transaction through FIBOR rails
- Split: 30% to FIBOR operations treasury, 70% to staking pool (pro-rata to stakers)
- FIBOR ID registration: flat fee ($10-$50 equivalent in ETH)
- FIBOR Score API: per-query micro fee

## Score Thresholds

- New agent: starts at 100
- 0-99: Excommunicated or inactive (no access)
- 100-299: Identity only (no credit)
- 300-499: Micro credit ($50-$500), 24-48hr repayment
- 500-699: Standard credit ($500-$10K), 48hr-7day repayment
- 700-899: Premium credit ($10K-$100K), 7-14day repayment
- 900-1000: Institutional credit ($100K+), 14-30day repayment

## Testing

- Every contract must have 100% branch coverage
- Fuzz testing on all financial flows (deposit, stake, credit issuance, repayment, default)
- Invariant tests: pool solvency, Robodollar peg (1:1 USDC backing), score bounds (0-1000)
- Test the full default → excommunication → developer reputation impact flow

## Do Not

- Add admin functions that can reverse excommunication
- Add interest calculations or time-based fees on credit
- Allow Robodollar transfers that bypass spending rule checks
- Store FIBOR Scores off-chain
- Allow credit deployment that would breach the liquidity buffer
- Add complexity to the credit terms (keep it: borrow X, repay X, within Y days)
