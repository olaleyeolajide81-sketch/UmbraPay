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
