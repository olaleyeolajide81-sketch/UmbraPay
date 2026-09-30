// Proof-server readiness, Midnight providers, and DUST setup.
//
// Shared by the deploy and interaction scripts: both need a reachable proof
// server, DUST to pay fees, and the same provider set. One implementation means
// a fix to any of them lands in both.

import * as Rx from 'rxjs';

import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';

import { zkConfigPath } from './contract';
import type { WalletContext } from './wallet';
import type { NetworkConfig, NetworkId } from './network';

// Upper bound on the DUST wait. A healthy devnet produces DUST within seconds
// of registration; anything approaching this means the node, the wallet's
// NIGHT balance, or the faucet is the real problem, and failing with that
// message beats hanging.
//
// Override with MIDNIGHT_DUST_TIMEOUT_MS when the network is degraded: DUST
// accrues on-chain and is only observed once the indexer is serving, so a
// recovering indexer can legitimately need more than the default window.
export function dustWaitTimeoutMs(): number {
  const raw = Number(process.env.MIDNIGHT_DUST_TIMEOUT_MS);
  return Number.isFinite(raw) && raw > 0 ? raw : 5 * 60 * 1000;
}

// ─── Proof server readiness ───────────────────────────────────────────────────

export async function waitForProofServer(
  proofServer: string,
  maxAttempts = 60,
  delayMs = 2000,
): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(proofServer, {
        method: 'GET',
        signal: AbortSignal.timeout(3000),
      });
      return true;
    } catch (err: any) {
      const code = err?.cause?.code || err?.code || '';
      if (code !== 'ECONNREFUSED' && code !== 'UND_ERR_CONNECT_TIMEOUT' && code !== 'UND_ERR_SOCKET') {
        return true;
      }
    }
    if (attempt < maxAttempts) {
      process.stdout.write(`\r  Waiting for proof server... (${attempt}/${maxAttempts})   `);
      await new Promise((r) => setTimeout(r, delayMs));
    }
  }
  return false;
}

// ─── Providers ────────────────────────────────────────────────────────────────

/**
 * Build the full provider set required by midnight-js deploy and interact scripts.
 *
 * Both `deploy.ts` and `interact.ts` call this function rather than each
 * constructing their own providers. A fix here — to retry logic, timeout
 * values, or WebSocket configuration — lands in both without duplication.
 *
 * The five providers returned:
 *
 * | Provider | Purpose |
 * |---|---|
 * | `privateStateProvider` | Stores and loads `UmbraPayPrivateState` in a local LevelDB, encrypted with `privateStatePassword`. Never touches the chain. |
 * | `publicDataProvider` | Reads public contract state from the Midnight indexer over HTTP+WS. Used to fetch the current ledger before a circuit call. |
 * | `zkConfigProvider` | Loads the prover and verifier keys from `managed/counter/keys/`. |
 * | `proofProvider` | Sends circuits to the local proof server (Docker, port 6300) and gets back serialised proofs. |
 * | `walletProvider` / `midnightProvider` | Balances, finalises, and submits transactions through the Midnight wallet. |
 *
 * Environment variables:
 *
 * | Variable | Purpose | Default |
 * |---|---|---|
 * | `PRIVATE_STATE_PASSWORD` | Encryption key for the LevelDB private-state store. Must be ≥ 16 characters. | `'Local-Devnet-Development-Placeholder-1'` |
 *
 * @param walletCtx - Wallet context returned by {@link buildWalletContext}.
 * @param networkConfig - Network configuration (indexer URL, proof server URL, etc.).
 */
export async function createProviders(walletCtx: WalletContext, networkConfig: NetworkConfig) {
  // The SDK requires the private-state password to be at least 16 characters.
  const privateStatePassword =
    process.env.PRIVATE_STATE_PASSWORD?.trim() || 'Local-Devnet-Development-Placeholder-1';

  const walletProvider = {
    getCoinPublicKey: () => walletCtx.shieldedSecretKeys.coinPublicKey,
    getEncryptionPublicKey: () => walletCtx.shieldedSecretKeys.encryptionPublicKey,
    async balanceTx(tx: any, ttl?: Date) {
      const recipe = await walletCtx.wallet.balanceUnboundTransaction(
        tx,
        { shieldedSecretKeys: walletCtx.shieldedSecretKeys, dustSecretKey: walletCtx.dustSecretKey },
        { ttl: ttl ?? new Date(Date.now() + 30 * 60 * 1000) },
      );
      return walletCtx.wallet.finalizeRecipe(recipe);
    },
    submitTx: (tx: any) => walletCtx.wallet.submitTransaction(tx) as any,
  };

  const zkConfigProvider = new NodeZkConfigProvider(zkConfigPath);
  const accountId = walletCtx.unshieldedKeystore.getBech32Address().toString();

  return {
    privateStateProvider: levelPrivateStateProvider({
      privateStateStoreName: 'umbrapay-state',
      accountId,
      privateStoragePasswordProvider: () => privateStatePassword,
    }),
    publicDataProvider: indexerPublicDataProvider(networkConfig.indexer, networkConfig.indexerWS),
    zkConfigProvider,
    proofProvider: httpClientProofProvider(networkConfig.proofServer, zkConfigProvider),
    walletProvider,
    midnightProvider: walletProvider,
  };
}

// ─── DUST ─────────────────────────────────────────────────────────────────────
//
// DUST is the non-transferable fee resource. A transaction with no DUST cannot
// be submitted, so both scripts wait here before doing anything on-chain.

/**
 * Ensure the wallet has DUST before attempting any on-chain transaction.
 *
 * DUST is the Midnight fee resource. It is non-transferable and is generated
 * by registering NIGHT UTXOs with the protocol. The sequence is:
 *
 * 1. If any unshielded NIGHT UTXOs are not yet registered for DUST generation,
 *    register them now (one transaction).
 * 2. If the DUST balance is still zero after registration, poll until DUST
 *    accrues or the timeout expires.
 *
 * DUST accrual is observed through the indexer, so a recovering indexer can
 * legitimately delay the observation even if DUST is already on-chain. Set
 * `MIDNIGHT_DUST_TIMEOUT_MS` to a larger value if the network is degraded.
 *
 * Exit conditions:
 * - Returns normally when DUST is available.
 * - Prints a diagnostic and calls `process.exit(1)` if DUST never arrives
 *   within the timeout. The diagnostic explains the three most common causes:
 *   Docker not running, wallet holds no NIGHT, faucet has not landed yet.
 *
 * @param walletCtx - Wallet context with a synced wallet.
 * @param network - The active network ID, used to tailor the diagnostic message.
 */

export async function ensureDust(
  walletCtx: WalletContext,
  network: NetworkId,
): Promise<void> {
  const timeoutMs = dustWaitTimeoutMs();
  const dustState = await Rx.firstValueFrom(
    walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)),
  );

  const unregisteredUtxos = dustState.unshielded.availableCoins.filter(
    (c: any) => !c.meta?.registeredForDustGeneration,
  );
  if (unregisteredUtxos.length > 0) {
    console.log(`  Registering ${unregisteredUtxos.length} NIGHT UTXOs for DUST generation...`);
    // The signDustRegistration callback already produces a recipe with N
    // signatures matching N inputs. Do NOT call signRecipe again — that would
    // double-sign and the chain rejects with InputsSignaturesLengthMismatch.
    const recipe = await walletCtx.wallet.registerNightUtxosForDustGeneration(
      unregisteredUtxos,
      walletCtx.unshieldedKeystore.getPublicKey(),
      (payload) => walletCtx.unshieldedKeystore.signData(payload),
    );
    const finalized = await walletCtx.wallet.finalizeRecipe(recipe);
    await walletCtx.wallet.submitTransaction(finalized);
  }

  if (dustState.dust.balance(new Date()) === 0n) {
    console.log('  Waiting for DUST tokens...');
    try {
      await Rx.firstValueFrom(
        walletCtx.wallet.state().pipe(
          Rx.throttleTime(5000),
          Rx.filter((s) => s.isSynced),
          Rx.filter((s) => s.dust.balance(new Date()) > 0n),
          Rx.timeout({ first: timeoutMs }),
        ),
      );
    } catch {
      console.log(`\n  ❌ No DUST generated after ${Math.round(timeoutMs / 60000)} minutes.\n`);
      console.log('  DUST pays transaction fees and is generated by registered NIGHT UTXOs.');
      console.log('    • The node may not be producing blocks — check: docker compose ps');
      console.log('    • The wallet may hold no NIGHT — check: npm run check-balance');
      if (network !== 'undeployed') {
        console.log(`    • The ${network} faucet may not have funded this address yet`);
      }
      console.log('');
      await walletCtx.wallet.stop();
      process.exit(1);
    }
  }
  console.log('  DUST tokens ready!\n');
}
