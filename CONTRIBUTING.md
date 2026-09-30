# Contributing to UmbraPay

Thank you for taking the time to contribute. This document explains how the
project works, what the toolchain constraints are, and what to check before
opening a pull request.

---

## Table of Contents

1. [Project overview](#project-overview)
2. [Prerequisites](#prerequisites)
3. [Getting started](#getting-started)
4. [Toolchain version lock](#toolchain-version-lock)
5. [Running tests](#running-tests)
6. [Making changes](#making-changes)
7. [Privacy guidelines](#privacy-guidelines)
8. [Opening a pull request](#opening-a-pull-request)
9. [Reporting bugs](#reporting-bugs)

---

## Project overview

UmbraPay is a private payroll settlement contract on the
[Midnight](https://midnight.network/) network. The repo has three layers:

| Layer | Location | Language |
|---|---|---|
| Settlement contract | `contracts/counter.compact` | Compact |
| Deploy / interact scripts | `src/*.ts` (Node) | TypeScript |
| Browser frontend | `src/components/`, `src/hooks/`, `src/lib/` | TypeScript + React |

The compiled contract artifacts in `managed/` are committed on purpose so the
circuits and keys can be reviewed without installing the Compact toolchain. CI
re-compiles them from source and diffs them to detect drift.

---

## Prerequisites

| Requirement | Version | Check |
|---|---|---|
| Node.js | v22.15+ | `node --version` |
| npm | v10+ | `npm --version` |
| Docker (with Compose v2) | any recent | `docker info` |
| Compact devtools | 0.5.x | `compact --version` |
| Compact toolchain | **0.31.1** | `compact compile --version` |

> **The Compact compiler is not an npm package.** `npm install -g
> @midnight-ntwrk/compact-compiler` returns 404. Install the devtools instead —
> see [Toolchain version lock](#toolchain-version-lock).

---

## Getting started

```bash
# 1. Clone the repo
git clone https://github.com/olaleyeolajide81-sketch/UmbraPay
cd UmbraPay

# 2. Install dependencies
npm install

# 3. Compile the contract (re-generates managed/)
npm run compact

# 4. Run the test suite (no Docker needed)
npm test
```

---

## Toolchain version lock

This project pins the Compact toolchain at **0.31.1** (see `.compact-version`).
This is not arbitrary — the toolchain and the JavaScript runtime are
version-locked:

```
Compact toolchain 0.31.1  →  emits checkRuntimeVersion('0.16.0')
@midnight-ntwrk/compact-runtime 0.16.0  ← exact pin in package.json
```

Installing the latest toolchain produces a different `checkRuntimeVersion()`
call and causes the contract to fail at deploy time — not at compile time.

**Always install the pinned version:**

```bash
# Install the Compact devtools (first time only)
curl --proto '=https' --tlsv1.2 -LsSf \
  https://github.com/midnightntwrk/compact/releases/latest/download/compact-installer.sh | sh
source $HOME/.local/bin/env

# Install the pinned toolchain
compact update "$(cat .compact-version)"

# Verify
compact compile --version   # must print 0.31.1
```

CI enforces this: the `contract` job fails if the active toolchain is not the
pinned one, if `managed/` drifts from a fresh compile, or if the runtime version
the compiler emits disagrees with the `compact-runtime` pin.

---

## Running tests

```bash
npm test                # run the 16-test suite (no Docker, no network)
npm run typecheck       # tsc --noEmit
npm run test:compile    # recompile from source, then test
```

All 16 tests must pass before opening a pull request. The test suite covers
circuit logic, state transitions, and privacy guarantees. The privacy tests
mechanically read the public ledger bytes and assert that no private witness
value (`salaryAmount`, `recipientSecret`, `paymentSalt`) appears anywhere in
the on-chain state — they do not rely on assertions about intent.

---

## Making changes

### Changing the Compact contract

1. Edit `contracts/counter.compact`.
2. Run `npm run compact` to regenerate `managed/`.
3. Run `npm test` — all 16 tests must pass.
4. Stage both `contracts/counter.compact` and the regenerated `managed/` in
   your commit. CI will verify that the committed artifacts match a fresh
   compile.

### Changing TypeScript source

1. Edit files under `src/` or `tests/`.
2. Run `npm run typecheck` to check types.
3. Run `npm test`.

### Changing the frontend

1. Edit files under `src/components/`, `src/hooks/`, `src/lib/`, or `src/App.tsx`.
2. Run `npm run dev` and verify the change in a Chromium browser with Lace installed.
3. Run `npm run build` to confirm the production build is clean.

---

## Privacy guidelines

UmbraPay's core contract is the **privacy boundary** between public ledger state
and private witnesses. Any change that touches this boundary needs extra care:

1. **Never add `disclose()` to a witness value without explicit justification.**
   The only three legitimate `disclose()` call sites are already in the contract:
   the policy floor, the commitment hash, and the running aggregate. A fourth call
   site must be reviewed as a privacy-model change, not a routine edit.

2. **Do not log, return, or store private witness values.** The witnesses in
   `src/witnesses.ts` must not write to any log, file, or network endpoint.

3. **Fresh randomness per payment.** Any change to `makePrivateState` in
   `src/contract.ts` must preserve the default of fresh-random `recipientSecret`
   and `paymentSalt`. Fixed or predictable values break the unlinkability guarantee.

4. **Run the privacy tests.** The six privacy tests in `tests/counter.test.ts`
   mechanically verify the guarantee. Any contract change that breaks them signals
   a privacy regression, not a test to be updated.

---

## Opening a pull request

1. Fork the repository and create a branch from `main`.
2. Make your changes following the guidelines above.
3. Ensure `npm test` and `npm run typecheck` both pass.
4. Push your branch and open a pull request against `main`.
5. Fill in the PR description: what changed, why, and what was tested.

CI runs automatically on every pull request. The `typecheck + tests` job and the
`contract + toolchain lock` job must both be green before a PR can be merged.

---

## Reporting bugs

For non-security bugs, open a [GitHub issue](https://github.com/olaleyeolajide81-sketch/UmbraPay/issues).
For security vulnerabilities, see [SECURITY.md](SECURITY.md) — please do not open
a public issue for security-related findings.
