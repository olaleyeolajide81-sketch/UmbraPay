# Security Policy

## Supported Versions

UmbraPay is currently a Midnight Builder Challenge submission running on the
**Preprod** testnet. No Mainnet deployment exists yet. The table below will be
updated as the project matures.

| Version | Supported |
|---|---|
| `main` branch (testnet) | ✅ Active development |
| Any prior tagged release | ❌ Not supported |

---

## Reporting a Vulnerability

**Please do not open a public GitHub issue for security vulnerabilities.**

Report security issues by emailing:

**olaleyeolajide81@gmail.com**

Include as much of the following as you can:

- A clear description of the vulnerability.
- Steps to reproduce, or a proof-of-concept.
- The component(s) affected (Compact contract, TypeScript witness layer,
  frontend, CI, deploy scripts, or dependency).
- The potential impact (privacy leak, fund loss, denial-of-service, etc.).

You will receive an acknowledgement within **48 hours** and a fuller response
within **5 business days**.

---

## Scope

### In scope

| Area | Notes |
|---|---|
| `contracts/counter.compact` | The Compact settlement contract — privacy boundary, `disclose()` call sites, circuit logic |
| `src/witnesses.ts` | TypeScript side of the privacy boundary; the witness implementations that supply private data to circuits |
| `src/contract.ts` | Compiled-contract loading; `makePrivateState`; env-var handling |
| `src/deploy.ts` / `src/interact.ts` | Deployment and on-chain interaction scripts |
| `src/` frontend components | React + Vite frontend; wallet connection; circuit invocation from the browser |
| `.github/workflows/ci.yml` | CI pipeline; supply-chain integrity of the toolchain version lock |
| Dependency versions | Suspicious or malicious package versions, unexpected transitive deps |

### Out of scope

- The Midnight protocol itself (report to the Midnight team).
- The Compact toolchain (report to IOG / Midnight).
- The Lace wallet extension (report to IOHK).
- Issues only reproducible on Mainnet once Mainnet exists (flag them, but
  Mainnet support is not yet in scope).

---

## Privacy Model — What This Repository Protects

The security boundary of UmbraPay is the **witness layer**. The Compact compiler
enforces that no witness-derived value reaches the public ledger without an explicit
`disclose()` call. The three `disclose()` call sites in `contracts/counter.compact`
are auditable at a glance:

```compact
payrollFloor = disclose(floor);                               // policy constant — safe to publish
const publicCommitment = disclose(payoutCommitment(...));     // commitment hash — preimage stays private
totalDisbursed = disclose((totalDisbursed + amount) as Uint<64>);  // aggregate — individual amount stays private
```

A vulnerability in this domain would be one that causes a private witness value
(`salaryAmount`, `recipientSecret`, or `paymentSalt`) to reach the public ledger or
any off-chain log in a form that allows recovery of the original value.

### Known limitation (documented, not a vulnerability)

In a payroll with exactly **one participant**, `totalDisbursed` equals that
participant's salary, so the amount can be inferred from the on-chain aggregate. This
is documented in the README and pinned by a dedicated test. It is an architectural
trade-off at Level 1, not a bug. Decoy payouts (Level 2) close it.

---

## Dependency Security

This project pins exact versions for all privacy-critical dependencies:

| Package | Pin | Reason |
|---|---|---|
| `@midnight-ntwrk/compact-runtime` | `0.16.0` (exact) | Must match the runtime version the Compact toolchain emits |
| `@midnight-ntwrk/onchain-runtime-v3` | `3.0.0` (overrides) | Deduplication prevents two-copy `instanceof` failures |
| Compact toolchain | `0.31.1` (`.compact-version`) | Toolchain/runtime version lock enforced by CI |

If you discover a dependency with an unexpected version in `package-lock.json`,
or a supply-chain issue with any pinned package, please report it as a
vulnerability.

---

## Acknowledgements

Security researchers who responsibly disclose issues will be credited in the
project changelog (with their permission).
