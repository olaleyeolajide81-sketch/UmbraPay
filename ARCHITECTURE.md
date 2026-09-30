# Architecture

This document describes how UmbraPay is structured, how its privacy boundary
works mechanically, and how the five layers interact at runtime.

---

## System Layers

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (Chromium + Lace wallet extension)                      │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │  React / Vite frontend                                     │  │
│  │  src/components/  src/hooks/  src/lib/                     │  │
│  │                                                            │  │
│  │  - WalletConnect  — connects to Lace, shows address badge  │  │
│  │  - CircuitCall    — invokes circuits, shows proof spinner  │  │
│  │  - App            — privacy model card, contract info      │  │
│  └──────────────────────────┬─────────────────────────────────┘  │
│                             │ dapp-connector-api                  │
│  ┌──────────────────────────▼─────────────────────────────────┐  │
│  │  Lace wallet                                               │  │
│  │  - Signs transactions, holds the user's keys               │  │
│  │  - Provides DUST for fees                                  │  │
│  └──────────────────────────┬─────────────────────────────────┘  │
└────────────────────────────-│────────────────────────────────────┘
                              │ HTTPS
┌─────────────────────────────▼────────────────────────────────────┐
│  Midnight Proof Server  (Docker — localhost:6300)                │
│  - Generates the ZK proof from the circuit + witnesses           │
│  - Private inputs enter here; they never leave this process      │
└─────────────────────────────┬────────────────────────────────────┘
                              │ Serialised proof
┌─────────────────────────────▼────────────────────────────────────┐
│  Midnight Node / Indexer  (Preview or Preprod testnet)           │
│  - Verifies the proof against the contract verifier key          │
│  - Applies the ledger transition if the proof is valid           │
│  - Indexes the new state for future queries                      │
└──────────────────────────────────────────────────────────────────┘
```

---

## Contract Layer (`contracts/counter.compact`)

The Compact contract is the **source of truth for the privacy boundary**. It has
four public ledger fields, three private witnesses, and three exported circuits:

```
PUBLIC LEDGER (on-chain, readable by anyone)
  payrollRound          Counter      — payout count; reveals timing, not amounts
  totalDisbursed        Uint<64>     — running aggregate; not individual amounts
  payrollFloor          Uint<64>     — published minimum-wage policy constant
  lastPayoutCommitment  Bytes<32>    — hash(amount, recipient, salt); no preimage

PRIVATE WITNESSES (held by the prover, never on-chain)
  salaryAmount()        Uint<64>
  recipientSecret()     Bytes<32>
  paymentSalt()         Bytes<32>

CIRCUITS
  commitPayout()        — settles one payout; updates aggregate + commitment
  proveAboveFloor()     — compliance assertion; zero ledger writes
  remainingBudget()     — pure read-only view
```

The Compact compiler enforces that no witness-derived value reaches the ledger
without an explicit `disclose()` call. UmbraPay has exactly **three** `disclose()`
call sites, auditable in one screenful of the contract source.

---

## TypeScript Witness Layer (`src/witnesses.ts`)

The `witnesses` object is the TypeScript counterpart of the Compact `witness`
declarations. The generated `Contract` class calls these functions during proof
generation to obtain the private inputs.

```
WitnessContext { ledger, privateState }
       │
       ├── salaryAmount()    → [privateState, bigint]
       ├── recipientSecret() → [privateState, Uint8Array]
       └── paymentSalt()     → [privateState, Uint8Array]
```

The witness functions receive the **public ledger** (read-only) and the **private
state** (read-write), and return the (possibly updated) private state alongside
the requested value. In UmbraPay the private state is read-only at proving time —
each function returns it unchanged.

---

## Contract Loading (`src/contract.ts`)

`contract.ts` is the bridge between the compiled Compact artifacts and the
TypeScript scripts. It:

1. Checks that `managed/counter/contract/index.js` exists (fail-fast if the
   contract has not been compiled).
2. Dynamically imports the generated binding.
3. Attaches the witnesses via `CompiledContract.withWitnesses`.
4. Attaches the compiled file assets (ZK keys) via
   `CompiledContract.withCompiledFileAssets`.

The resulting `compiledContract` object is consumed by both `deploy.ts` (to
deploy a new instance) and `interact.ts` (to call circuits on an existing one).

---

## Deployment Pipeline (`src/deploy.ts`)

```
npm run deploy -- --network preprod
          │
          ▼
  1. Load or generate wallet seed  (.midnight-state.json — gitignored)
  2. Derive wallet address          (deterministic, no sync needed)
  3. Sync wallet state              (replays from genesis on first run)
  4. Poll for faucet funds          (zero balance → wait)
  5. Register NIGHT, poll for DUST  (fee resource)
  6. Prove the constructor          (private input: payrollFloor)
  7. Submit deployment transaction
  8. Print contract address
```

The constructor's `floor` parameter is a private circuit input. The contract
publishes it via `disclose(floor)` as `payrollFloor` — the only time a
constructor argument reaches the ledger. This is intentional: the floor is the
public policy constant against which all future payouts are checked.

---

## On-chain Interaction (`src/interact.ts`)

```
npm run interact -- --network preprod
          │
          ▼
  1. Load wallet + contract address from .midnight-state.json
  2. Build compiledContract (same object as deploy.ts)
  3. Create privateState from MIDNIGHT_SALARY_AMOUNT (default: payrollFloor)
  4. Call commitPayout()
     - Proof generated locally by the proof server
     - Proof submitted to the node; ledger updated on-chain
     - Print public ledger BEFORE and AFTER
  5. Call proveAboveFloor()
     - Zero ledger writes — compliance assertion only
     - Re-read ledger, assert it is byte-for-byte unchanged
     - Exit non-zero if the ledger changed (would indicate a contract bug)
```

---

## Frontend Runtime (`src/lib/midnight-browser.ts`)

The browser frontend uses a subset of the same primitives, routed through the
Lace wallet's DApp connector:

```
useMidnight() hook
       │
       ├── connect()          — DApp connector handshake
       ├── commitPayout()     — builds privateState from user input,
       │                        generates proof in-browser,
       │                        submits via wallet
       └── proveAboveFloor()  — same flow; zero ledger writes
```

The ZK proof is generated entirely in the browser by the Midnight proof server
over localhost (Docker). The private inputs (`salaryAmount`, `recipientSecret`,
`paymentSalt`) are constructed in-browser from user input and fresh randomness
and are **never transmitted to any server or stored in any log**.

---

## Toolchain / Runtime Version Lock

```
.compact-version  →  0.31.1
      │
      └── compact compile contracts/counter.compact managed/counter
                │
                └── managed/counter/contract/index.js
                        │
                        └── __compactRuntime.checkRuntimeVersion('0.16.0')
                                │
                                └── @midnight-ntwrk/compact-runtime@0.16.0 (exact pin)
```

A newer toolchain emits a different `checkRuntimeVersion()` value and causes
the contract to refuse to load at runtime. CI enforces the lock on every push.

The `@midnight-ntwrk/onchain-runtime-v3` package is pinned to `3.0.0` via
`overrides` in `package.json` to prevent two-copy `instanceof` failures. See
the README for a full explanation of both traps.

---

## CI Pipeline (`.github/workflows/ci.yml`)

| Job | Purpose |
|---|---|
| `typecheck + tests` | `tsc --noEmit`, then `vitest run` (16 tests). Also asserts exactly one copy of `onchain-runtime-v3` on disk. |
| `contract + toolchain lock` | Installs Compact devtools, installs toolchain `0.31.1`, recompiles `counter.compact`, diffs against `managed/`. Fails on toolchain mismatch, `managed/` drift, or runtime version disagreement. |

Both jobs run on a plain GitHub runner with Node 22 only. No Docker, no wallet,
no funds are needed for CI. Deploys and on-chain calls are deliberate human
actions.
