# Product Proposal

## What is the product, and who uses it?

[I WILL FILL THIS IN]

<!--
Suggested prompts:
- What is the name of your product?
- Who are the primary users / customers?
- What problem does it solve for them?
- What is the core action a user takes on-chain?
-->

## Why Midnight specifically?

[I WILL FILL THIS IN — what does Midnight do that a transparent
chain could not do well for this product?]

<!--
Suggested prompts:
- What private data must stay off-chain for this product to work?
- How does Midnight's disclose() model enforce that boundary?
- What would break if you deployed the same contract on a transparent chain?
-->

## Data Model

| Data Point             | Type            | Disclosed To        |
|------------------------|-----------------|---------------------|
| `payrollRound`         | Public ledger   | Everyone            |
| `totalDisbursed`       | Public ledger   | Everyone            |
| `payrollFloor`         | Public ledger   | Everyone            |
| `lastPayoutCommitment` | Public ledger   | Everyone            |
| `salaryAmount`         | Private witness | No one (ZK only)    |
| `recipientSecret`      | Private witness | No one (ZK only)    |
| `paymentSalt`          | Private witness | No one (ZK only)    |
| [example — add rows]   | [type]          | [who]               |

<!--
Add or remove rows to match your actual contract's ledger fields and witnesses.
Each row should answer: "who can see this data point on-chain?"
-->

## Mainnet Feasibility

[I WILL FILL THIS IN — is this realistic to reach Mainnet by Level 6?]

<!--
Suggested prompts:
- What features are missing before this could run on Mainnet?
- What are the biggest technical risks?
- What is your estimated timeline from Level 3 → Mainnet?
-->
