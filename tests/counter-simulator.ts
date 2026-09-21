// ============================================================================
// UmbraPay — contract simulator
// ============================================================================
//
// Runs the compiled contract entirely in-process against `compact-runtime`,
// with no chain, no wallet, and no proof server involved.
//
// This is why the tests below can assert privacy properties directly: the
// simulator hands us the exact `Ledger` object the contract produced, so "the
// salary never reached the ledger" is a statement we can check mechanically
// rather than take on faith.
//
// The pattern mirrors Midnight's own example projects — execute the
// constructor once to derive the initial ledger state, then thread the returned
// `CircuitContext` through each successive circuit call.
//
// VERSION NOTE — why this file pins compact-runtime 0.16.0
// ----------------------------------------------------------------------------
// The Compact toolchain and the JavaScript runtime are version-locked: a
// contract compiled by a given toolchain refuses to load under a mismatched
// runtime. Toolchain 0.31.1 (the version create-mn-app pins in its
// `.compact-version`) emits `checkRuntimeVersion('0.16.0')`.
//
// The midnight-js 4.1.1 stack that this project deploys with also ships
// compact-runtime 0.16.0. Staying on 0.31.1 / 0.16.0 therefore keeps the local
// tests, the compiled artifacts, and the deploy path on one consistent pair.
// Using the newest toolchain (0.34.0, emitting a 0.19.0 requirement) makes the
// contract compile but fail to load at deploy time.
//
// In 0.16.0 the contract API is SYNCHRONOUS (`initialState` and every circuit
// return their results directly, not promises) and `createCircuitContext` takes
// a flat four-argument form. This class keeps an `async` public surface anyway,
// so that a future runtime bump to the promise-based API is a change to this
// file alone rather than to every test.
//
// ============================================================================

import {
  type CircuitContext,
  type ConstructorContext,
  createCircuitContext,
  createConstructorContext,
  sampleContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { Contract, type Ledger, ledger } from '../managed/counter/contract/index.js';
import { type UmbraPayPrivateState, witnesses } from './witnesses.js';

/** A stand-in Zswap coin public key; the contract does not spend coins in these tests. */
const COIN_PUBLIC_KEY = '0'.repeat(64);

/** Everything needed to stand up one payroll instance. */
export type UmbraPayInit = {
  /** The public minimum-wage floor, baked in at construction. */
  floor: bigint;
} & UmbraPayPrivateState;

/**
 * Drives one deployed UmbraPay contract instance.
 */
export class UmbraPaySimulator {
  readonly contract: Contract<UmbraPayPrivateState>;
  #circuitContext: CircuitContext<UmbraPayPrivateState>;

  private constructor(
    contract: Contract<UmbraPayPrivateState>,
    circuitContext: CircuitContext<UmbraPayPrivateState>,
  ) {
    this.contract = contract;
    this.#circuitContext = circuitContext;
  }

  /**
   * Deploy a fresh payroll instance and run its constructor.
   *
   * The constructor is where `payrollFloor` is disclosed, the aggregate is
   * zeroed, the round counter is opened, and the genesis commitment is stamped.
   */
  static async create(init: UmbraPayInit): Promise<UmbraPaySimulator> {
    const contract = new Contract<UmbraPayPrivateState>(witnesses);

    const privateState: UmbraPayPrivateState = {
      salaryAmount: init.salaryAmount,
      recipientSecret: init.recipientSecret,
      paymentSalt: init.paymentSalt,
    };

    const constructorContext: ConstructorContext<UmbraPayPrivateState> = createConstructorContext(
      privateState,
      COIN_PUBLIC_KEY,
    );

    const { currentPrivateState, currentContractState, currentZswapLocalState } =
      contract.initialState(constructorContext, init.floor);

    const circuitContext = createCircuitContext(
      sampleContractAddress(),
      currentZswapLocalState.coinPublicKey,
      currentContractState.data,
      currentPrivateState,
    );

    return new UmbraPaySimulator(contract, circuitContext);
  }

  /** The public on-chain ledger, exactly as a chain observer would see it. */
  public getLedger(): Ledger {
    return ledger(this.#circuitContext.currentQueryContext.state);
  }

  /** The private payroll record. In a real deployment this lives on the user's device. */
  public getPrivateState(): UmbraPayPrivateState {
    return this.#circuitContext.currentPrivateState;
  }

  /**
   * Swap in a different employee's private payroll record.
   *
   * Models advancing to the next recipient: the public ledger carries over
   * untouched while the private inputs change underneath it.
   */
  public setPrivateState(next: UmbraPayPrivateState): void {
    this.#circuitContext = { ...this.#circuitContext, currentPrivateState: next };
  }

  /** Settle one payout. Returns the disclosed commitment and the resulting ledger. */
  public async commitPayout(): Promise<{ commitment: Uint8Array; ledger: Ledger }> {
    const { result, context } = this.contract.impureCircuits.commitPayout(this.#circuitContext);
    this.#circuitContext = context;
    return { commitment: result, ledger: this.getLedger() };
  }

  /** Prove the private salary clears the public floor, publishing nothing. */
  public async proveAboveFloor(): Promise<Ledger> {
    const { context } = this.contract.impureCircuits.proveAboveFloor(this.#circuitContext);
    this.#circuitContext = context;
    return this.getLedger();
  }

  /** Read remaining budget against the public aggregate. */
  public async remainingBudget(budget: bigint): Promise<bigint> {
    const { result, context } = this.contract.impureCircuits.remainingBudget(
      this.#circuitContext,
      budget,
    );
    this.#circuitContext = context;
    return result;
  }
}
