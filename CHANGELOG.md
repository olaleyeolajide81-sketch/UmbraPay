# Changelog

All notable changes to UmbraPay are recorded in this file.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
The project is a Midnight Builder Challenge submission; version numbers track
challenge levels rather than semver releases.

---

## [Level 3] — 2026-09-30

### Added
- `PROPOSAL.md` — comprehensive product proposal with problem statement, user
  roles, privacy model rationale, data model table, and Mainnet feasibility
  assessment with estimated timeline.
- `SECURITY.md` — vulnerability disclosure policy, scope table, privacy model
  summary, and dependency security notes.
- `CONTRIBUTING.md` — contributor guide covering prerequisites, toolchain
  version lock, running tests, privacy guidelines, and PR process.
- `CHANGELOG.md` — this file; records milestones from Level 1 through Level 3.
- Expanded JSDoc on `src/witnesses.ts`: per-witness explanations of which
  circuit uses each value, why it stays off-chain, and cross-references to the
  Compact declarations.
- Expanded JSDoc on `src/contract.ts`: `PAYROLL_FLOOR` documents the
  `MIDNIGHT_PAYROLL_FLOOR` override; `makePrivateState` documents
  `MIDNIGHT_RECIPIENT_SECRET` and `MIDNIGHT_PAYMENT_SALT` with format,
  defaults, and a warning about fixed-salt linkability.

### Changed
- `PROPOSAL.md` — replaced all `[I WILL FILL THIS IN]` placeholders with full
  prose derived from the README and contract source.

---

## [Level 3 CI] — 2026-09-30

### Added
- `.github/workflows/ci.yml` — `typecheck + tests` job and `contract +
  toolchain lock` job. The second job fails the build if the active Compact
  toolchain is not `0.31.1`, if `managed/` drifts from a fresh compile, or if
  the runtime version the compiler emits disagrees with `compact-runtime@0.16.0`.
- Assertion in the `test` job that exactly one copy of
  `@midnight-ntwrk/onchain-runtime-v3` is installed, preventing the silent
  two-copy `instanceof` failure on the first on-chain circuit call.

---

## [Level 2 — Frontend] — 2026-09-30

### Added
- React 19 + Vite 7 browser frontend in `src/components/` and `src/hooks/`.
- Lace wallet connect via `@midnight-ntwrk/dapp-connector-api`.
- Live circuit calls (`commitPayout`, `proveAboveFloor`) against the Preprod
  deployment at `14f9…7f3`.
- Privacy Model card, Contract info card, wallet address badge, proof-generation
  spinner, on-chain result display, and privacy badge — all four Step 7 demo
  checklist items.
- Vercel deployment (`vercel.json`, `.github/workflows/deploy-vercel.yml`).
  Live at [umbrapay.vercel.app](https://umbrapay.vercel.app).
- Netlify backup deployment. Live at
  [coruscating-figolla-f21c7e.netlify.app](https://coruscating-figolla-f21c7e.netlify.app).
- Demo video (`demo-video.mp4`, `demo-video.webm`) recorded with the Playwright
  headless recorder in `scripts/record-demo.mjs`. Covers all four checklist
  moments without requiring a live wallet or proof server.

---

## [Level 2 — Preprod Deployment] — 2026-09-23

### Added
- Preprod contract deployed at
  `14f9ade83ce4f188662767edb3a5607d6f43e67d6c09d84fd8932b82dcdf07f3`.
- Preprod deployer wallet:
  `mn_addr_preprod1qmj3wfykapy3c0zvuxgplh78qg993xuhn00v3fe86srtce9qzt7s2gh8st`.
- On-chain interaction receipts for both `commitPayout()` and
  `proveAboveFloor()` against Preprod — two live transactions with block heights
  and transaction IDs documented in the README.

### Notes
- First deploy attempt blocked by a Preprod indexer outage (`503`, no healthy
  backends for ~1 hour). Deployment succeeded on the first attempt after the
  indexer recovered.

---

## [Level 1 — Preview Deployment] — 2026-09-22

### Added
- Preview contract deployed at
  `8c1765ec101c02e4d4a024c7416185f9d619fcc296aebaf55b436159aed57a5c`.
- Preview deployer wallet:
  `mn_addr_preview1y73mmfdus9dn3c7c0wkf4nm79qed5zdvj4nuhpzhrg4zxpvxvn2q9ffrny`.
- On-chain interaction script (`src/interact.ts`) exercising `commitPayout()`
  and `proveAboveFloor()` against the live Preview deployment; the script
  re-reads the ledger after `proveAboveFloor()` and exits non-zero if the
  ledger changed.
- `npm run address` — derives the wallet address without syncing or an RPC call.
- `npm run check-balance` — balance and DUST diagnostics.

---

## [Level 1 — Contract Core] — 2026-09-22

### Added
- `contracts/counter.compact` — UmbraPay settlement contract with three circuits:
  - `commitPayout()` — settles one payout: asserts the private salary meets the
    public floor, publishes the commitment hash and the new aggregate.
  - `proveAboveFloor()` — asserts minimum-wage compliance with zero ledger writes.
  - `remainingBudget()` — pure read-only view over public state.
- `managed/counter/` — compiled artifacts (circuits, ZKIR, prover/verifier keys)
  committed for reviewability without requiring the toolchain.
- `src/witnesses.ts` — TypeScript witness implementations (privacy boundary).
- `src/contract.ts` — compiled-contract loading, `makePrivateState`, env-var wiring.
- `src/providers.ts` — proof server, Midnight providers, DUST.
- `src/deploy.ts` — deploy to Preview / Preprod with wallet sync and DUST polling.
- `src/network.ts` — network configs, faucet URLs, seed management.
- `src/wallet.ts` / `src/wallet-state.ts` — wallet construction and sync-state restore.
- `tests/counter.test.ts` — 16 tests covering circuit logic, state transitions,
  and privacy guarantees (including mechanical byte-level ledger inspection).
- `tests/counter-simulator.ts` — in-process driver over `compact-runtime`.
- `.compact-version` — pins Compact toolchain at `0.31.1`.
- `docker-compose.yml` — proof server pinned to `8.1.0`.
- `package.json` — `npm run compact`, `npm test`, `npm run deploy`,
  `npm run interact`, `npm run address`.
- `screenshots/` — generated SVG captures of compile output, test run, deploy,
  and on-chain interaction.
