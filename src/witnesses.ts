// ============================================================================
// UmbraPay — witness implementations
// ============================================================================
//
// This module is the TypeScript side of the PRIVACY BOUNDARY declared in
// contracts/counter.compact.
//
// Each function below corresponds to a `witness` declared in the Compact
// contract. A witness is the ONLY channel through which private data enters a
// circuit. The values returned here are handed to the prover and are never
// written to the ledger — unless the contract explicitly wraps them in
// disclose(), which counter.compact does for exactly three audited values and
// never for the three below.
//
// The `privateState` payload is what a real deployment would keep on the
// user's own device: an encrypted local store, a hardware wallet, or a
// browser tab's private storage. It is deliberately NOT part of the ledger.
//
// ============================================================================

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../managed/counter/contract/index.js';

/**
 * The private payroll record for one recipient.
 *
 * Everything in this object stays on the prover's machine. It is the data that
 * UmbraPay exists to protect: who is paid, how much, and a per-payment salt
 * that makes two identical salaries produce different commitments.
 */
export type UmbraPayPrivateState = {
  /** What this individual is actually paid. Never leaves the device. */
  readonly salaryAmount: bigint;
  /** The recipient identity. Never leaves the device. */
  readonly recipientSecret: Uint8Array;
  /** Per-payment randomness, so equal salaries yield unlinkable commitments. */
  readonly paymentSalt: Uint8Array;
};

/**
 * The witness set passed to the generated `Contract` class.
 *
 * Each witness receives a {@link WitnessContext} — which deliberately exposes
 * only the *public* ledger plus this contract's private state — and returns the
 * (possibly updated) private state alongside the requested value.
 *
 * The contract declares three witnesses:
 *
 * ```compact
 * witness salaryAmount():    Uint<64>
 * witness recipientSecret(): Bytes<32>
 * witness paymentSalt():     Bytes<32>
 * ```
 *
 * None of these values ever reach the public ledger. The Compact compiler
 * tracks witness-derived values through every expression in a circuit and
 * refuses to compile any path that writes them to ledger state without an
 * explicit `disclose()` call. The three `disclose()` call sites in
 * `counter.compact` all operate on derived public data (the commitment hash,
 * the aggregate, and the policy floor), never on the raw witnesses here.
 *
 * @see {@link UmbraPayPrivateState} for the shape of the private record.
 * @see `contracts/counter.compact` for the corresponding Compact declarations.
 */
export const witnesses = {
  /**
   * Returns the individual's salary from private state.
   *
   * Used by `commitPayout()` to assert `amount >= payrollFloor` and fold the
   * amount into `totalDisbursed`. The amount itself is never written to the
   * ledger — only the aggregate is.
   *
   * Used by `proveAboveFloor()` to assert the floor bound and publish nothing.
   */
  salaryAmount: ({
    privateState,
  }: WitnessContext<Ledger, UmbraPayPrivateState>): [UmbraPayPrivateState, bigint] => [
    privateState,
    privateState.salaryAmount,
  ],

  /**
   * Returns the recipient identity from private state.
   *
   * Used by `commitPayout()` as one of the three inputs to `payoutCommitment()`.
   * The commitment is a hash; its preimage (including this value) is never
   * published. The recipient identity is therefore unrecoverable from the chain.
   */
  recipientSecret: ({
    privateState,
  }: WitnessContext<Ledger, UmbraPayPrivateState>): [UmbraPayPrivateState, Uint8Array] => [
    privateState,
    privateState.recipientSecret,
  ],

  /**
   * Returns the per-payment random salt from private state.
   *
   * Used by `commitPayout()` to ensure that two payouts with identical amounts
   * and identical recipients produce different commitments. Without this salt,
   * equal earners could be clustered off the ledger by comparing commitment
   * bytes. The salt must be fresh for each payment; the default in
   * {@link makePrivateState} generates it with `crypto.getRandomValues`.
   */
  paymentSalt: ({
    privateState,
  }: WitnessContext<Ledger, UmbraPayPrivateState>): [UmbraPayPrivateState, Uint8Array] => [
    privateState,
    privateState.paymentSalt,
  ],
};
