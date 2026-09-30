// ============================================================================
// UmbraPay — browser-side Midnight SDK integration
// ============================================================================
//
// This module bridges the Lace/Midnight DApp Connector (injected into the
// browser window by the wallet extension) with the Midnight.js provider stack
// the contract circuits need. It runs entirely in the browser — no Node
// built-ins, no disk I/O.
//
// What lives here:
//   connectWallet()       — request wallet access and return wallet info
//   callProveAboveFloor() — run the proveAboveFloor circuit against the live contract
//   callCommitPayout()    — run the commitPayout circuit against the live contract
//
// The private witnesses (salary, secret, salt) are assembled inside this
// module and handed directly to the proof machinery. They are NEVER returned
// to the React layer and NEVER appear in any state the component renders.
// ============================================================================

import type { InitialAPI, ConnectedAPI } from '@midnight-ntwrk/dapp-connector-api';
import { FetchZkConfigProvider } from '@midnight-ntwrk/midnight-js-fetch-zk-config-provider';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import {
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import type {
  WalletProvider,
  MidnightProvider,
  MidnightProviders,
} from '@midnight-ntwrk/midnight-js-types';
import { witnesses } from '../witnesses.js';

// ---------------------------------------------------------------------------
// Network endpoint constants (Preprod)
// ---------------------------------------------------------------------------

/** The Preprod contract deployed in Level 1. */
export const CONTRACT_ADDRESS =
  '14f9ade83ce4f188662767edb3a5607d6f43e67d6c09d84fd8932b82dcdf07f3';

/** Midnight network ID string for Preprod. */
const NETWORK_ID = 'TestNet';

/** Preprod Midnight network endpoints. */
const PREPROD = {
  indexer: 'https://indexer.preprod.midnight.network/api/v4/graphql',
  indexerWS: 'wss://indexer.preprod.midnight.network/api/v4/graphql',
  proofServer: 'https://proof.preprod.midnight.network',
};

/** Private state storage slot — must match the deploy-time slot. */
const PRIVATE_STATE_ID = 'umbrapay-private-state';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type WalletInfo = {
  /** Human-readable address to display in the UI. */
  address: string;
  /** The raw DApp connector wallet API (for signing). */
  walletApi: ConnectedAPI;
};

export type TxResult = {
  txHash: string;
  blockHeight: number;
  circuitName: string;
};

// ---------------------------------------------------------------------------
// Wallet connection
// ---------------------------------------------------------------------------

/**
 * Request access to the injected Midnight DApp Connector (Lace wallet).
 *
 * Throws a descriptive error for each of the three failure modes the UI
 * needs to display:
 *   - Wallet extension not installed
 *   - User rejected the connection request
 *   - Connected to the wrong network
 */
export async function connectWallet(): Promise<WalletInfo> {
  const mnApis = getMidnightApis();

  if (mnApis.length === 0) {
    throw new Error(
      'Lace wallet not found — please install the Lace browser extension and enable Midnight support.',
    );
  }

  const initial = mnApis[0];

  let walletApi: ConnectedAPI;
  try {
    walletApi = await initial.connect('TestNet');
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    if (
      msg.toLowerCase().includes('user declined') ||
      msg.toLowerCase().includes('rejected') ||
      msg.toLowerCase().includes('denied')
    ) {
      throw new Error('Connection rejected — please approve the request in Lace.');
    }
    throw new Error(`Wallet connection failed: ${msg}`);
  }

  // Verify the wallet is on the correct network.
  const config = await walletApi.getConfiguration();
  if (config.networkId !== NETWORK_ID) {
    throw new Error(
      `Wrong network — this dApp uses Preprod (${NETWORK_ID}). Switch your Lace wallet to Preprod and try again. (Got: ${config.networkId})`,
    );
  }

  // Get the unshielded address to display in the UI.
  const { unshieldedAddress: address } = await walletApi.getUnshieldedAddress();

  return { address, walletApi };
}

/**
 * Enumerate all injected Midnight wallet APIs from `window.midnight`.
 */
function getMidnightApis(): InitialAPI[] {
  const midnight = (window as unknown as Record<string, unknown>)['midnight'];
  if (typeof midnight !== 'object' || midnight === null) return [];
  return Object.values(midnight as Record<string, unknown>).filter(
    (v): v is InitialAPI =>
      typeof v === 'object' &&
      v !== null &&
      'connect' in v &&
      typeof (v as InitialAPI).connect === 'function',
  );
}

// ---------------------------------------------------------------------------
// Provider assembly
// ---------------------------------------------------------------------------

/**
 * Build a WalletProvider adapter from the DApp Connector API.
 *
 * The Midnight.js WalletProvider interface requires:
 *   - balanceTx(tx, ttl?)     — balance an unbound transaction
 *   - getCoinPublicKey()      — the shielded coin public key
 *   - getEncryptionPublicKey() — the shielded encryption public key
 *
 * We use the DApp Connector's `balanceUnsealedTransaction` for balancing and
 * the proving provider it exposes for proving.
 */
async function buildWalletProvider(walletApi: ConnectedAPI): Promise<WalletProvider> {
  const { shieldedCoinPublicKey, shieldedEncryptionPublicKey } =
    await walletApi.getShieldedAddresses();

  return {
    getCoinPublicKey: () => shieldedCoinPublicKey as unknown as ReturnType<WalletProvider['getCoinPublicKey']>,
    getEncryptionPublicKey: () => shieldedEncryptionPublicKey as unknown as ReturnType<WalletProvider['getEncryptionPublicKey']>,
    async balanceTx(tx: Parameters<WalletProvider['balanceTx']>[0], _ttl?: Date) {
      // Serialize the unbound transaction and send it to the wallet for balancing.
      const serialized = JSON.stringify(tx);
      const result = await walletApi.balanceUnsealedTransaction(serialized);
      return JSON.parse(result.tx);
    },
  };
}

/**
 * Build a MidnightProvider adapter that uses the DApp Connector to submit transactions.
 */
function buildMidnightProvider(walletApi: ConnectedAPI): MidnightProvider {
  return {
    async submitTx(tx: Parameters<MidnightProvider['submitTx']>[0]) {
      const serialized = JSON.stringify(tx);
      await walletApi.submitTransaction(serialized);
      // submitTransaction on ConnectedAPI returns void; the txId is embedded in the tx.
      return (tx as unknown as { id: string }).id ?? '';
    },
  };
}

/**
 * Build the full Midnight.js provider stack for a connected wallet session.
 */
async function buildProviders(
  walletInfo: WalletInfo,
): Promise<MidnightProviders> {
  setNetworkId(NETWORK_ID);

  const zkConfigProvider = new FetchZkConfigProvider(
    // sync-zk-assets.mjs copies managed/counter/{keys,zkir} to public/zk/
    `${window.location.origin}/zk`,
    fetch.bind(window),
  );

  const proofProvider = httpClientProofProvider(
    PREPROD.proofServer,
    zkConfigProvider,
  );

  const publicDataProvider = indexerPublicDataProvider(
    PREPROD.indexer,
    PREPROD.indexerWS,
  );

  const privateStateProvider = levelPrivateStateProvider({
    privateStateStoreName: PRIVATE_STATE_ID,
    privateStoragePasswordProvider: () => `umbrapay-dapp-${walletInfo.address.slice(-16)}`,
    accountId: walletInfo.address,
  });

  const walletProvider = await buildWalletProvider(walletInfo.walletApi);
  const midnightProvider = buildMidnightProvider(walletInfo.walletApi);

  return {
    zkConfigProvider,
    proofProvider,
    publicDataProvider,
    privateStateProvider,
    walletProvider,
    midnightProvider,
  };
}

// ---------------------------------------------------------------------------
// Circuit calls
// ---------------------------------------------------------------------------

/**
 * Call `proveAboveFloor()` against the live Preprod contract.
 *
 * This circuit proves the salary clears the published floor and publishes
 * NOTHING — no ledger write, no return value. It is a pure zero-knowledge
 * assertion.
 *
 * Private inputs are assembled here and handed to the prover. They are never
 * returned and never surface in the React state.
 */
export async function callProveAboveFloor(
  walletInfo: WalletInfo,
  salaryAmount: bigint,
): Promise<TxResult> {
  return runCircuit(walletInfo, 'proveAboveFloor', salaryAmount);
}

/**
 * Call `commitPayout()` against the live Preprod contract.
 *
 * This circuit proves and publishes:
 *   - that the salary clears the floor
 *   - a hash commitment of (amount, recipientSecret, paymentSalt)
 *   - the updated totalDisbursed aggregate
 *
 * Private inputs are assembled here. The individual salary, recipient, and
 * salt are NEVER returned to the caller.
 */
export async function callCommitPayout(
  walletInfo: WalletInfo,
  salaryAmount: bigint,
): Promise<TxResult> {
  return runCircuit(walletInfo, 'commitPayout', salaryAmount);
}

// ---------------------------------------------------------------------------
// Internal — circuit runner
// ---------------------------------------------------------------------------

async function runCircuit(
  walletInfo: WalletInfo,
  circuitName: 'proveAboveFloor' | 'commitPayout',
  salaryAmount: bigint,
): Promise<TxResult> {
  // Lazy-load the compiled contract. Dynamic import is intentional — the contract
  // module calls checkRuntimeVersion, which must run after the WASM module initialises.
  const Counter = await import('../../managed/counter/contract/index.js');

  // Assemble private witnesses entirely in this scope. They never leave.
  const initialPrivateState = {
    salaryAmount,
    recipientSecret: crypto.getRandomValues(new Uint8Array(32)),
    paymentSalt: crypto.getRandomValues(new Uint8Array(32)),
  };

  const providers = await buildProviders(walletInfo);

  // Build the CompiledContract by composing the generated module with witnesses.
  // The `any` casts here are intentional — dynamic imports prevent the conditional
  // generics from resolving, and casting at this one boundary keeps the rest typed.
  const { CompiledContract } = await import('@midnight-ntwrk/midnight-js-protocol/compact-js');
  const compiledContract = (CompiledContract.make('counter', Counter.Contract) as any).pipe(
    (CompiledContract.withWitnesses as any)(witnesses),
  );

  // Locate the already-deployed contract. findDeployedContract verifies the
  // on-chain verifier keys match our compiled artifacts and returns a callTx
  // interface for each circuit.
  const deployed = await findDeployedContract(providers as any, {
    compiledContract,
    contractAddress: CONTRACT_ADDRESS,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState,
  });

  // Call the requested circuit and wait for on-chain finalization.
  const tx =
    circuitName === 'proveAboveFloor'
      ? await deployed.callTx.proveAboveFloor()
      : await deployed.callTx.commitPayout();

  const pub = tx.public as unknown as Record<string, unknown>;
  return {
    txHash: String(pub['txId'] ?? pub['txHash'] ?? '(unknown)'),
    blockHeight: Number(pub['blockHeight'] ?? 0),
    circuitName,
  };
}
