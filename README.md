# UmbraPay

> Payroll that proves it is fair without revealing who earns what.

UmbraPay is a private payroll settlement contract on the [Midnight](https://midnight.network/)
network. Organisations publish that a payroll ran, that it respected a minimum-wage
floor, and what it paid in total — while every individual salary and every recipient
identity stays on the payer's own device.

---

## Contract Address

| Network  | Address                                      |
|----------|----------------------------------------------|
| Preview  | *pending first deploy — see [Deploying](#deploying)* |
| Preprod  | *not deployed yet*                            |

The deploy writes the address to `.midnight-state.json` and prints it to the console.
Paste it into the table above.

---

## What This Does

A normal on-chain payroll leaks everything: every salary and every recipient is public
forever. A normal off-chain payroll proves nothing, so employees and auditors have to
take the numbers on trust. UmbraPay sits in between.

For each payout, the payer's device proves three things to the chain:

1. **The salary clears a published minimum.** `payrollFloor` is public ledger state, so
   anyone can verify that nobody was paid below it.
2. **This payout is the one being claimed.** The contract publishes a commitment — a
   hash binding the amount, the recipient, and a per-payment salt — which acts as a
   tamper-evident receipt without revealing any of those three inputs.
3. **The published total is the real total.** `totalDisbursed` accumulates on-chain, so
   the aggregate is auditable and the individual amounts are not.

The result: a payroll that can be audited in aggregate and audited for policy compliance,
while remaining unreadable one row at a time.

---

## Privacy Model

### What is PUBLIC (on-chain, visible to anyone)

| Ledger field | Type | What it reveals |
|---|---|---|
| `payrollRound` | `Counter` | How many payout rounds have settled. Reveals that a payout happened, nothing more. |
| `totalDisbursed` | `Uint<64>` | The running *aggregate* of all payouts. |
| `payrollFloor` | `Uint<64>` | The minimum any worker may be paid. A published policy constant, deliberately disclosed in the constructor. |
| `lastPayoutCommitment` | `Bytes<32>` | A hash binding the latest payout's `(amount, recipientSecret, paymentSalt)`. A receipt whose preimage is never published. |

### What is PRIVATE (private witness, never on-chain)

| Witness | Type | Why it is private |
|---|---|---|
| `salaryAmount()` | `Uint<64>` | What this individual is actually paid. |
| `recipientSecret()` | `Bytes<32>` | Who the payment is for. |
| `paymentSalt()` | `Bytes<32>` | Per-payment randomness, so two equal salaries never produce equal commitments. |

These are supplied by the prover and never written to the ledger. The tests prove this
mechanically rather than asserting it — see [Privacy Tests](#privacy-tests).

### What the user PROVES without revealing

- **`commitPayout()`** — *"I know an `(amount, secret, salt)` triple that hashes to the
  commitment I am publishing, and that amount is at least `payrollFloor`."* The verifier
  learns the floor was respected and that the aggregate moved. They never learn the
  amount or the recipient.
- **`proveAboveFloor()`** — *"the salary I hold privately clears the public floor."*
  Publishes **nothing at all**: no ledger write, no return value. A pure zero-knowledge
  assertion, and the compliance primitive an auditor actually wants.

### On `disclose()`

In Compact, a witness-derived value cannot reach the ledger unless the developer explicitly
wraps it in `disclose()`. That friction is the point, and this contract uses it at exactly
**three auditable call sites**, each on data already designed to be public:

```compact
payrollFloor = disclose(floor);                              // constructor arg — private
                                                             // input, public policy constant
const publicCommitment = disclose(payoutCommitment(...));    // the receipt hash, not its preimage
totalDisbursed = disclose((totalDisbursed + amount) as Uint<64>);  // the aggregate
```

**No `disclose()` is ever applied directly to `salaryAmount()`, `recipientSecret()`, or
`paymentSalt()`.** The disclosure surface is three lines you can read, not a scattered one.

> The compiler enforced this rather than us remembering it. The constructor's `floor`
> parameter is a *private circuit input* like any witness, and `compact compile` refused
> to let `payrollFloor = floor` leak silently — it demanded an explicit `disclose`.
> That is the single best argument for using this language.

### Known limitation (Level 1)

`totalDisbursed` is a deliberate disclosure, so **a payroll with exactly one participant
leaks that participant's salary through the aggregate** — the recipient stays private, the
amount does not. A real payroll has several participants, in which case only the aggregate
is published and the split stays private. There is an explicit test pinning this behaviour
(`documents a known Level 1 limit: a one-participant payroll exposes that salary via the
aggregate`) so it cannot regress silently. Level 2 addresses it with decoy payouts and
batched disclosure windows.

---

## Tech Stack

- **Midnight network** — Preview / Preprod testnets, or a local devnet
- **Compact language** — the privacy-preserving smart contract language
- **Compact toolchain 0.31.1** — pinned; see [the version lock](#the-toolchainruntime-version-lock)
- **Node.js 22** (v22.15+ required)
- **Docker** — runs the proof server
- **TypeScript + Vitest** — contract tests over `compact-runtime`
- **midnight-js 4.1.1 + wallet-sdk 1.2.0** — deployment and wallet plumbing

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | v22.15+ | `node --version` |
| npm | v10+ | `npm --version` |
| Docker (with Compose v2) | any recent | `docker info` |
| Compact devtools | 0.5.x | `compact --version` |
| Compact toolchain | 0.31.1 | `compact compile --version` |

The **Compact compiler is not an npm package.** `npm install -g
@midnight-ntwrk/compact-compiler` does not exist (404). Install the devtools, then let
`compact` manage the toolchain:

```bash
# 1. Install the Compact devtools
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh

# 2. Put it on PATH
source $HOME/.local/bin/env

# 3. Install the toolchain version this project pins
compact update "$(cat .compact-version)"     # → 0.31.1

# 4. Verify
compact compile --version                     # → 0.31.1
```

---

## Setup

```bash
# Clone
git clone https://github.com/olaleyeolajide81-sketch/UmbraPay
cd UmbraPay

# Install dependencies
npm install

# Start the proof server (required to deploy and to interact on-chain)
docker compose up -d

# Compile the contract
npm run compact
```

`npm run compact` runs:

```bash
compact compile contracts/counter.compact managed/counter
```

You should see:

```
Compiling 3 circuits:
```

and a `managed/counter/` directory containing:

```
managed/counter/
├── compiler/           contract-info.json, contract-manifest.json
├── contract/           index.js, index.d.ts   ← the TypeScript binding
├── keys/               <circuit>.prover, <circuit>.verifier   ← per circuit
└── zkir/               <circuit>.zkir, <circuit>.bzkir        ← ZK intermediate representation
```

### Optional: live Midnight documentation via MCP

`.mcp.json` wires the Midnight docs MCP server for Claude Code / Cursor users. Note that
`https://midnight.mcp.kapa.ai` is **OAuth-protected** — it returns `401` until you
authenticate through your client's MCP UI.

---

## Run Tests

```bash
npm test
```

Expected:

```
✓ tests/counter.test.ts (16 tests)

Test Files  1 passed (1)
     Tests  16 passed (16)
```

Also available:

```bash
npm run typecheck     # tsc --noEmit
npm run test:compile  # recompile the contract, then test
```

The suite needs **no Docker, no wallet, and no network** — it runs the compiled contract
in-process against `compact-runtime`.

### What the tests cover

**Circuit logic** (6 tests) — the aggregate moves by exactly the private amount; a payout
below the floor is rejected; the floor boundary is inclusive; `proveAboveFloor` publishes
nothing; `remainingBudget` reads correctly and rejects an exceeded budget.

**State transitions** (4 tests) — initialisation publishes the disclosed floor with a zero
aggregate; initialisation is deterministic across independent deployments; the aggregate
accumulates and the round counter advances once per payout; identical private inputs yield
identical commitments.

**Privacy guarantees** (6 tests) — the interesting ones.

### Privacy Tests

These do not assert intent. They read the actual `Ledger` object the contract produced and
search its bytes for the private values:

- `never writes any private input to the public ledger` — searches the flattened ledger
  bytes for the raw `recipientSecret` and `paymentSalt`.
- `does not publish an individual salary anywhere in the ledger bytes` — settles two
  payouts (4000 and 6000), confirms the published aggregate is 10000, and confirms
  **neither** 4000 nor 6000 appears anywhere, in the same 32-byte big-endian encoding the
  contract uses internally for amounts.
- `exposes only the four declared public fields on the ledger` — asserts the ledger has
  exactly the four public keys and no witness-named key.
- `keeps two equal salaries unlinkable via per-payment salt` — two identical salaries with
  different salts produce different commitments, so equal earners cannot be clustered off
  the ledger.
- `keeps the private state off the ledger and restorable from the local record` — the
  private record survives settling, and none of it reaches the chain.
- `documents a known Level 1 limit...` — pins the one-participant aggregate leak.

---

## Deploying

### 1. Check your wallet address and fund it

```bash
npm run address -- --network preview
```

This derives the address from the seed instantly (no sync) and prints the faucet URL.
Fund it at the **Preview faucet**: <https://midnight-tmnight-preview.nethermind.dev>

### 2. Deploy

```bash
npm run deploy -- --network preview
```

The script:

1. Resolves the network and gets or generates this network's wallet (a new wallet prints
   its 24-word recovery phrase **once** — back it up).
2. Syncs the wallet. **On Preview the first sync takes ~15 minutes**, as it replays from
   genesis. Sync state is cached in `.midnight-wallet-state/`, so later runs are fast.
3. Polls for your faucet funds if the balance is zero.
4. Registers NIGHT for DUST generation and waits for DUST (the fee resource).
5. Proves and submits the deployment, then prints the contract address.

The constructor takes the public payroll floor. Override it with:

```bash
MIDNIGHT_PAYROLL_FLOOR=2500 npm run deploy -- --network preview
```

For Preprod:

```bash
npm run address -- --network preprod     # faucet: https://midnight-tmnight-preprod.nethermind.dev
npm run deploy  -- --network preprod
```

### Proof server

```bash
docker compose up -d      # start (pinned to proof-server 8.1.0)
docker compose down       # stop
```

If the proof server is not running, proofs fail with `connect ECONNREFUSED 127.0.0.1:6300`.

---

## The toolchain/runtime version lock

**This is the trap that costs the most time on Midnight, so it is worth stating plainly.**

The Compact compiler and the JavaScript runtime are **version-locked**. A contract compiled
by toolchain X refuses to load under a mismatched runtime — the generated code opens with
`__compactRuntime.checkRuntimeVersion('...')` and throws if it disagrees.

Installing the newest toolchain is the wrong move:

| Combination | Result |
|---|---|
| Toolchain `0.34.0` (latest) | Emits `checkRuntimeVersion('0.19.0')`. midnight-js 4.1.1 pins compact-runtime to **exactly `0.16.0`**, so the contract compiles but **fails to load at deploy time**. |
| Toolchain **`0.31.1`** ✅ | Emits `checkRuntimeVersion('0.16.0')` — matches. |

`@midnight-ntwrk/compact-js@2.5.1` declares `"@midnight-ntwrk/compact-runtime": "0.16.0"`
as an exact pin, and the Midnight `create-mn-app` scaffolder pins `0.31.1` in its
`.compact-version`. This project pins the same value in `.compact-version` — **always
install the pinned toolchain, not the latest.**

```bash
compact update "$(cat .compact-version)"   # 0.31.1
compact use 0.31.1
```

If you see a runtime version mismatch error, this is the cause.

---

## Project Structure

```
UmbraPay/
├── contracts/
│   └── counter.compact        # the UmbraPay contract (name fixed by the Level 1 spec)
├── managed/
│   └── counter/               # auto-generated by `compact compile` (committed on purpose)
│       ├── compiler/          # contract metadata
│       ├── contract/          # index.js + index.d.ts TypeScript binding
│       ├── keys/              # per-circuit prover + verifier keys
│       └── zkir/              # per-circuit ZK intermediate representation
├── src/
│   ├── witnesses.ts           # the PRIVACY BOUNDARY, TypeScript side
│   ├── deploy.ts              # deploy to Preview / Preprod
│   ├── address.ts             # print the wallet address without syncing
│   ├── network.ts             # network configs, faucet URLs, seed management
│   ├── wallet.ts              # wallet construction + sync-state restore
│   ├── wallet-state.ts        # on-disk wallet sync-state format
│   └── check-balance.ts       # balance / DUST diagnostics
├── tests/
│   ├── counter.test.ts        # 16 tests: logic, transitions, privacy
│   └── counter-simulator.ts   # in-process driver over compact-runtime
├── .github/workflows/         # CI/CD (Level 3)
├── .compact-version           # pins the Compact toolchain — 0.31.1
├── .mcp.json                  # Midnight docs MCP server
├── docker-compose.yml         # proof server, pinned to 8.1.0
└── README.md
```

### Why `managed/` is committed

`create-mn-app` gitignores `managed/`, because it is regenerable. This repository commits it
instead, so the compiled circuits, their ZKIR and their proving/verifying keys can be
reviewed without installing the Compact toolchain. Regenerate any time with `npm run compact`.

### Why the contract is called `counter.compact`

The filename is fixed by the Level 1 spec, but the contract inside is not a toy counter —
it is UmbraPay's payroll settlement core. The `Counter` is the count of settled payout
rounds, which is what the spec's "public ledger state" requirement is satisfied by. The
rationale is documented at the top of `contracts/counter.compact`.

---

## Troubleshooting

| Symptom | Cause / fix |
|---|---|
| `compact: command not found` | Run `source $HOME/.local/bin/env` to put the devtools on PATH. |
| `npm install -g @midnight-ntwrk/compact-compiler` → 404 | That package does not exist. Install the devtools as shown in [Prerequisites](#prerequisites). |
| `checkRuntimeVersion` mismatch at deploy | Toolchain/runtime version lock — see [above](#the-toolchainruntime-version-lock). Install `compact update 0.31.1`. |
| `connect ECONNREFUSED 127.0.0.1:6300` | Proof server is down: `docker compose up -d`. |
| Deploy hangs on "Still syncing..." | Normal on Preview — the first sync replays from genesis (~15 min). Sync state is cached, so reruns are fast. |
| `Balance: 0 tNight` after using the faucet | The faucet transaction has not landed yet. The deploy polls for up to `MIDNIGHT_FAUCET_TIMEOUT_MS` (default 600000). |
| `Insufficient Funds` / `Not enough Dust` on the first deploy attempt | Expected race between the DUST balance projection and block accounting. The script retries 20 times, 5s apart. |
| DUST never arrives | The wallet holds no NIGHT, or the node is not producing blocks. Check `npm run check-balance`. |
| MCP server returns 401 | `midnight.mcp.kapa.ai` is OAuth-protected. Authenticate via your client's MCP UI. |

---

## Initial Idea

<!-- LEAVE AS PLACEHOLDER — to be filled in manually -->

---

## Screenshots

<!-- LEAVE AS PLACEHOLDER — add:
     - `compact compile` output showing the 3 circuits
     - the `managed/counter/` directory with keys and zkir
     - `npm test` showing 16 passing tests
     - the deploy output with the contract address
-->
