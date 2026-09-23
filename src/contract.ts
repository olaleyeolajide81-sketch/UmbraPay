// Compiled-contract loading, shared by the deploy and interaction scripts.
//
// Both scripts must agree on three things or the interaction would silently use
// a different contract, a different private-state slot, or different witnesses:
//
//   compiledContract   which circuits and keys to prove against
//   PRIVATE_STATE_ID   which local slot holds the witness record
//   makePrivateState   the shape of that record

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

import { witnesses, type UmbraPayPrivateState } from './witnesses';
import type { Ledger } from '../managed/counter/contract/index.js';

export type { Ledger };

/** Generated assets: circuits, ZKIR, and the prover/verifier keys. */
export const zkConfigPath = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '..',
  'managed',
  'counter',
);

const contractPath = path.join(zkConfigPath, 'contract', 'index.js');

if (!fs.existsSync(contractPath)) {
  console.error('\n❌ Contract not compiled! Run: npm run compact\n');
  process.exit(1);
}

const Counter = await import(pathToFileURL(contractPath).href);

// Unlike the hello-world template, this contract HAS witnesses, so they are
// attached with withWitnesses rather than withVacantWitnesses.
//
// The CompiledContract combinators are typed with conditional generics that
// resolve to `never` when the contract class is imported dynamically at runtime
// (which it must be here, since the path is only known at execution time).
// Casting the combinators at this one boundary keeps the rest of the codebase
// fully typechecked rather than sprinkling `any` through the deploy logic.
export const compiledContract = (CompiledContract.make('counter', Counter.Contract) as any).pipe(
  (CompiledContract.withWitnesses as any)(witnesses),
  (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
);

/**
 * Read the public ledger out of a contract state fetched from the indexer.
 *
 * `state` is the `data` field of a queried `ContractState`; the generated
 * `ledger()` decoder is what turns those raw `StateValue` bytes into the four
 * public fields.
 */
export const ledgerOf = (state: any): Ledger => Counter.ledger(state);

/** Identifier under which this contract's private state is stored locally. */
export const PRIVATE_STATE_ID = 'umbraPayPrivateState';

/**
 * The published minimum-wage floor, passed to the contract constructor.
 *
 * The constructor parameter is a private circuit input, so the contract
 * discloses it explicitly — this value becomes public, by design.
 */
export const PAYROLL_FLOOR = BigInt(process.env.MIDNIGHT_PAYROLL_FLOOR?.trim() || '1000');

/**
 * Build a private payroll record for one recipient.
 *
 * In production each employee's own device holds its own record and supplies it
 * as the witness at proving time; nothing here is ever published. Fresh
 * randomness per payment is what keeps two equal salaries unlinkable, so the
 * defaults are random rather than fixed: the same salary paid twice must not
 * produce the same commitment.
 */
export function makePrivateState(salaryAmount: bigint): UmbraPayPrivateState {
  const secretHex = process.env.MIDNIGHT_RECIPIENT_SECRET?.trim();
  const saltHex = process.env.MIDNIGHT_PAYMENT_SALT?.trim();

  return {
    salaryAmount,
    recipientSecret: secretHex ? fromHex(secretHex, 'MIDNIGHT_RECIPIENT_SECRET') : randomBytes32(),
    paymentSalt: saltHex ? fromHex(saltHex, 'MIDNIGHT_PAYMENT_SALT') : randomBytes32(),
  };
}

function randomBytes32(): Uint8Array {
  return crypto.getRandomValues(new Uint8Array(32));
}

function fromHex(hex: string, varName: string): Uint8Array {
  const clean = hex.startsWith('0x') || hex.startsWith('0X') ? hex.slice(2) : hex;
  if (!/^[0-9a-fA-F]{64}$/.test(clean)) {
    throw new Error(`${varName} must be 64 hex characters (32 bytes).`);
  }
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) out[i] = parseInt(clean.slice(i * 2, i * 2 + 2), 16);
  return out;
}

/**
 * Placeholder private payroll record for the deploying identity.
 *
 * A real deployment would supply each recipient's own record; the deploy
 * transaction only needs *a* well-formed record to initialize the private-state
 * slot.
 */
export const INITIAL_PRIVATE_STATE: UmbraPayPrivateState = {
  salaryAmount: PAYROLL_FLOOR,
  recipientSecret: new Uint8Array(32).fill(0x1a),
  paymentSalt: new Uint8Array(32).fill(0x2b),
};
