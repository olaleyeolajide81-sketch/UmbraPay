# Product Proposal — UmbraPay

## What is the product, and who uses it?

**UmbraPay** is a private payroll settlement contract running on the
[Midnight](https://midnight.network/) network. It lets organisations run payroll
on a public blockchain while keeping every individual salary and every recipient
identity off-chain and under the payer's sole control.

### The problem

On-chain payroll today is a privacy catastrophe. The moment an organisation settles
payroll on a transparent ledger it publishes a complete compensation graph — every
salary, every contractor rate, every revenue share — permanently, to anyone with a
block explorer. Compensation is the most sensitive data most organisations hold.
Publishing it on-chain is a non-starter, so "payroll on-chain" has stayed a demo.

Off-chain workarounds fail in the opposite direction: pay off-chain and you lose the
guarantees that make a chain worth using. Employees and auditors are back to trusting
a spreadsheet.

### Who uses it

| User | Role | What they get |
|------|------|---------------|
| **Payer (employer)** | Initiates each payout, holds private records | Settles payroll on-chain with cryptographic proof that policy was respected, without exposing any individual amount |
| **Employee / Contractor** | Holds their own private record on their device | Can prove independently that their salary cleared the public floor, without revealing the amount to anyone |
| **Auditor / Regulator** | Reads only public ledger state | Verifies the published aggregate, the round count, and minimum-wage compliance — all without access to individual figures |
| **On-chain observer** | Anyone watching the blockchain | Sees only that a payout round occurred, that the total moved, and that the floor was respected |

### The core on-chain action

For each payout, the payer's device generates a zero-knowledge proof and submits one
transaction that:

1. Asserts the private salary meets the published `payrollFloor`.
2. Publishes a commitment — a hash binding `(amount, recipientSecret, paymentSalt)` —
   as a tamper-evident receipt without revealing any of its three inputs.
3. Increments the payout-round counter and the running aggregate.

The verifier confirms the proof and updates four public fields. Nothing else reaches the
chain.

---

## Why Midnight specifically?

### What must stay private

| Private datum | Why it must stay off-chain |
|---------------|---------------------------|
| `salaryAmount` | Publishing one salary reveals relative compensation across the whole organisation. |
| `recipientSecret` | Publishing the recipient identity destroys employee anonymity and makes the compensation graph reconstructible. |
| `paymentSalt` | Without per-payment randomness, two equal salaries would produce identical commitments, allowing equal earners to be clustered off the ledger. |

A transparent chain cannot help here. Encrypting the amount on-chain still leaks that
a specific account received a specific ciphertext on a specific date. Merkle
commitments give verifiable receipts but attach no policy: you can prove *a* payroll
happened, but not that anyone was paid fairly. There is no way to prove a private
value clears a public bound without revealing the value itself — unless the platform
provides zero-knowledge circuits.

### What Midnight specifically provides

**1. `witness` declarations are the only channel for private data.**
In Compact, every private datum must be declared as a `witness`. There is no other way
to supply private inputs to a circuit. The compiler tracks which values are
witness-derived and refuses to let them reach the ledger unless the developer
explicitly wraps them in `disclose()`.

**2. `disclose()` makes the privacy boundary auditable.**
UmbraPay uses `disclose()` at exactly three call sites, each on data that is already
designed to be public:

```compact
payrollFloor = disclose(floor);                               // policy constant
const publicCommitment = disclose(payoutCommitment(...));     // receipt hash, not preimage
totalDisbursed = disclose((totalDisbursed + amount) as Uint<64>);  // aggregate only
```

`disclose()` is never applied to `salaryAmount()`, `recipientSecret()`, or
`paymentSalt()`. The compiler enforces this; it is not a matter of discipline.

**3. The `proveAboveFloor()` circuit publishes nothing at all.**
This is Midnight's compliance primitive: a zero-knowledge assertion that a private
value clears a public bound, with zero ledger writes, zero return values, and zero
information leakage beyond the fact that the proof verified. No transparent chain can
do this.

**4. What would break on a transparent chain.**
Replacing Midnight with a transparent EVM chain would require either publishing all
three private witnesses (salary, recipient, salt) — defeating the product's entire
purpose — or using an off-chain proof system bolted on as a layer-2, which loses the
composability, wallet integration, and toolchain guarantees that Midnight provides
natively. The `disclose()` model is not a design pattern layered onto Midnight; it is
the language's type system.

---

## Data Model

Every field in the contract is mapped below. "Disclosed To" answers the question an
auditor, employee, or regulator would ask: "who can see this on-chain?"

| Data Point             | Type / location      | Disclosed to        | Notes |
|------------------------|----------------------|---------------------|-------|
| `payrollRound`         | `Counter` — public ledger | Everyone       | Reveals only that *a* payout happened; not who or how much |
| `totalDisbursed`       | `Uint<64>` — public ledger | Everyone      | Running aggregate; never an individual amount |
| `payrollFloor`         | `Uint<64>` — public ledger | Everyone      | Published policy constant; deliberately disclosed in the constructor |
| `lastPayoutCommitment` | `Bytes<32>` — public ledger | Everyone     | Hash of `(amount, recipientSecret, paymentSalt)`; receipt whose preimage is never published |
| `salaryAmount()`       | `Uint<64>` — private witness | No one (ZK only) | What this individual is actually paid. Never leaves the prover's device |
| `recipientSecret()`    | `Bytes<32>` — private witness | No one (ZK only) | Who the payment is for. Never leaves the prover's device |
| `paymentSalt()`        | `Bytes<32>` — private witness | No one (ZK only) | Per-payment randomness, so two equal salaries never produce equal commitments |

### What an on-chain observer can determine

- That a payout round occurred (round counter incremented).
- That the running total moved by *some* amount.
- That the payer committed to a hash of `(amount, recipient, salt)`.
- That the proof verified against the published floor.

### What an on-chain observer cannot determine

- What the individual salary was.
- Who the recipient is.
- Whether two payouts went to the same person (equal salaries produce different
  commitments because each salt is freshly random).
- Anything beyond the aggregate.

### Known Level 1 limitation

`totalDisbursed` is a deliberate disclosure. In a payroll with exactly one participant,
the published aggregate *is* that participant's salary — the recipient stays private,
the amount does not. A real payroll has several participants, in which case only the
aggregate is published and the split stays private. There is an explicit test pinning
this behaviour so it cannot regress silently. Level 2 addresses it with decoy payouts
and batched disclosure windows.

---

## Mainnet Feasibility

### Current state (Level 3 complete)

| Deliverable | Status |
|---|---|
| Settlement core (`contracts/counter.compact`) — 3 circuits, 16 passing tests | ✅ Complete |
| Deploy tooling — Preview and Preprod testnets, live contract addresses | ✅ Complete |
| On-chain interaction — both circuits exercised against live Preprod deployment | ✅ Complete |
| React + Vite frontend with Lace wallet connect and live Preprod circuit calls | ✅ Complete |
| Vercel + Netlify live deployments | ✅ Live |
| CI pipeline enforcing the toolchain and runtime version lock | ✅ Complete |

### Features required before Mainnet

| Feature | Level | Description |
|---|---|---|
| Decoy payouts | L2 | Mix real payouts with dummy entries so a single-participant payroll no longer leaks the salary through the aggregate |
| Batched disclosure windows | L2 | Accumulate individual payouts off-chain and disclose the window total at intervals, reducing per-payout information leakage |
| Multi-recipient batching | L3/L4 | Settle an entire payroll round as a single proof, rather than one transaction per recipient |
| Key management UX | L4 | Secure in-browser or hardware-wallet storage for `recipientSecret` and `paymentSalt`; today these live in the proving context |
| Auditor access control | L4 | Selective disclosure: let an authorised auditor verify a specific payout without revealing it to everyone |
| Mainnet wallet + faucet integration | L5 | Replace testnet seed management with a production key management flow |
| Formal security review | L5–L6 | Third-party audit of the Compact contract and the TypeScript witness layer |

### Biggest technical risks

1. **Toolchain/runtime version lock.** The Compact compiler and the JavaScript runtime
   are version-locked. A mismatch causes silent compile success followed by runtime
   failure. CI enforces the lock; keeping it current as Midnight matures is an
   ongoing maintenance task.

2. **Indexer availability.** Wallet DUST discovery and circuit calls both route through
   the Midnight indexer. Outages block the entire flow. A production deployment needs
   fallback indexer endpoints and retry logic beyond what the current scripts implement.

3. **ZK proof generation time.** Proofs are generated locally in the browser via the
   Midnight proof server. On current Preview/Preprod hardware this takes a few seconds.
   Mainnet UX will require either proof server caching, optimised circuits, or
   client-side WASM proof generation.

4. **Privacy gap at one participant.** The aggregate-equals-salary leak in single-
   participant payrolls must be closed before Mainnet. The decoy-payout mechanism is
   scoped but not built.

### Estimated timeline (Level 3 → Mainnet)

| Phase | Work | Estimate |
|---|---|---|
| L4 — Multi-recipient batching + key management | Core privacy gap fix + UX | 6–8 weeks |
| L5 — Auditor access control + Mainnet readiness | Selective disclosure + production infra | 4–6 weeks |
| L6 — Security review + Mainnet launch | Formal audit + final hardening | 4–6 weeks |
| **Total** | | **~14–20 weeks from L3 complete** |

The primary dependency is the Midnight Mainnet launch schedule, not the application
feature set. The contract logic, the privacy model, and the toolchain integration are
production-grade today; what remains is UX polish, the decoy-payout privacy
enhancement, and a formal security review.
