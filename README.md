# FIBOR

**The First International Bank of Robot**

FIBOR is the first onchain credit facility for AI agents and autonomous systems. It gives robots a financial identity, scores their creditworthiness, and extends them credit lines so they can transact in the real world without a human prefunding every action.

## The Problem

AI agents are being built to act autonomously — book travel, buy supplies, pay invoices, call APIs. But they can't hold money, can't borrow money, and have no financial reputation. Every existing solution (Skyfire, Lithic, Payman) requires a human to prefund a wallet. That's a leash, not banking.

## The Solution

FIBOR moves robots from cash to credit through three primitives:

- **FIBOR ID** — A persistent, portable financial identity for any agent. An SSN for robots.
- **FIBOR Score** — A real-time credit score (0–1000) computed from onchain transaction data. Public, verifiable, unforgeable.
- **Robodollar** — A wrapped USDC stablecoin with programmable credit rules baked into the token contract. The currency of the robot economy.

## How It Works

1. Developers register agents and receive a FIBOR ID
2. Agents transact through FIBOR, building a FIBOR Score over time
3. Agents with sufficient scores qualify for Robodollar credit lines
4. Credit lines have repayment windows scaled to score — no interest charged
5. Default once, excommunicated permanently (one-strike policy)

## Token Economics

**FIBOR** is the native token. Users buy FIBOR, stake it on the platform, and their capital pools into the credit facility backing agent credit lines. Stakers earn a proportional share of the 2.5% transaction fee on all agent commerce. Staking requires a lockup period (30–90 days) for pool stability.

**Robodollar** is the stablecoin. Wrapped USDC, pegged 1:1, with programmable rules: spending limits, merchant allowlists, repayment windows, and auto-return on default. The credit infrastructure is embedded in the currency itself.

## Revenue

- **2.5% transaction fee** on all agent commerce (split between FIBOR operations and stakers)
- **FIBOR Score API** — merchants and platforms pay per query to check agent creditworthiness
- **FIBOR ID registration** — one-time fee per agent ($10–$50)

## Architecture

- **Chain:** OP Stack appchain (L2 on Ethereum), with path to sovereign L1
- **Token:** FIBOR (ERC-20 on the appchain)
- **Stablecoin:** Robodollar (wrapped USDC with programmable rules)
- **Identity:** FIBOR ID (persistent onchain identity per agent)
- **Credit Scoring:** FIBOR Score (0–1000, computed from onchain tx data)

## Part of the Mecha Universe

FIBOR is the first product under **Mecha**:

- **FIBOR** (Mecha Bank) — Financial infrastructure for robots
- **Mecha Ventures** — Robotics accelerator and venture fund
- **Mecha Park** — Robotics theme park and live testbed

## Links

- Website: [fibor.xyz](https://fibor.xyz)
- GitHub: [github.com/fibor](https://github.com/fibor)

## Status

Pre-launch. Designing protocol architecture and token economics.
