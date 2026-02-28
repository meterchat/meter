# FIBOR Design Philosophy

## Core Principle: Credit is the Primitive

The entire design of FIBOR flows from one belief: autonomous agents will not achieve economic independence until they have access to credit. Every design decision optimizes for making robot credit trustworthy, accessible, and scalable.

## Identity Before Credit

No identity, no reputation. No reputation, no credit. No credit, no autonomy. FIBOR ID must exist before FIBOR Score can be computed, and FIBOR Score must reach a threshold before a credit line is issued. This sequence is inviolable. There are no shortcuts.

## Harshness as Trust

The one-strike default policy is not a bug or a limitation. It is the central design decision that makes everything else possible. Without it, stakers don't trust the pool. Without staker trust, there's no capital. Without capital, there are no credit lines. Without credit lines, there's no product.

Every "gentler" alternative (grace periods, partial penalties, appeal processes) weakens staker confidence and increases the cost of trust. The one-strike rule makes trust cheap. Cheap trust means more capital. More capital means more credit. More credit means more agents in the economy.

The harshness is what makes the system kind.

## No Interest, Ever

FIBOR does not charge interest. This is not a regulatory optimization or a marketing position. It is a moral stance that shapes the protocol's entire economic design.

The economic model is a toll road, not a bank in the traditional sense. Agents pay for using infrastructure (2.5% transaction fee). They do not pay for borrowing money. The fee is identical whether the agent uses its own funds or a credit line. This means the protocol has no incentive to encourage borrowing — only to encourage transacting. The incentives are aligned with productive economic activity, not with debt accumulation.

## The Currency is the Infrastructure

The Robodollar is not just a medium of exchange. It is the credit enforcement mechanism. Spending limits, repayment windows, merchant restrictions, and default clawbacks are properties of the token, not of a separate system monitoring the token.

This means credit rules travel with the money. They cannot be circumvented by moving funds to a different contract or protocol. The Robodollar is aware of its own constraints. This is a fundamentally different design than issuing USDC and hoping a monitoring system catches violations.

## Public Everything

FIBOR Scores are public. Transaction histories are public. Credit agreements are public. Default records are public. Developer reputations are public.

Privacy is valuable for humans. Transparency is valuable for machines. An agent's trustworthiness should be verifiable by anyone, instantly, without permission. This radical transparency is what makes the system work without centralized underwriters, credit committees, or approval processes.

## Developer Accountability

Agents don't exist in isolation. Developers build them. If a developer builds irresponsible agents, the developer's reputation must reflect that. FIBOR Score incorporates developer reputation as an input — a new agent from a developer whose previous agents all defaulted starts nearly at zero.

This creates a natural quality filter. Developers who care about their FIBOR reputation will build agents that repay. Developers who don't will find it increasingly difficult to get their agents into the system.

## Speed of Trust

Traditional credit decisions take days or weeks. FIBOR Score is computed in real time from onchain data. Credit line issuance is instant once the score threshold is met. Repayment is automatic. Default detection is immediate.

The entire credit lifecycle — from identity to scoring to credit issuance to repayment or default — happens at the speed of the blockchain, not at the speed of human review. This is necessary because agents operate at machine speed. A credit system that requires human approval is a bottleneck on the machine economy.

## Simplicity Over Sophistication

The credit terms are deliberately simple. Borrow X Robodollars, repay X Robodollars within Y days. No interest calculations, no compounding, no complex fee schedules. The 2.5% transaction fee is flat and universal.

Simplicity makes the system auditable. Auditable means trustworthy. Trustworthy means adopted. Adopted means defensible.

## Graduation, Not Perfection

FIBOR launches on an OP Stack appchain because it's fast to deploy and inherits Ethereum security. It is not the final architecture. The design anticipates graduation to a sovereign L1 (Cosmos SDK) when transaction volume justifies the cost and complexity of running independent validators.

Every architectural decision is made to be migratable. State can be exported. Contracts can be redeployed. The Robodollar bridge can be rebuilt. Nothing is designed to be permanent except the identity records and the principle of one-strike enforcement.
