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
 */
export const witnesses = {
  salaryAmount: ({
    privateState,
  }: WitnessContext<Ledger, UmbraPayPrivateState>): [UmbraPayPrivateState, bigint] => [
    privateState,
    privateState.salaryAmount,
  ],

  recipientSecret: ({
    privateState,
  }: WitnessContext<Ledger, UmbraPayPrivateState>): [UmbraPayPrivateState, Uint8Array] => [
    privateState,
    privateState.recipientSecret,
  ],

  paymentSalt: ({
    privateState,
  }: WitnessContext<Ledger, UmbraPayPrivateState>): [UmbraPayPrivateState, Uint8Array] => [
    privateState,
    privateState.paymentSalt,
  ],
};
