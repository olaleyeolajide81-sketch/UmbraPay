/**
 * Deploy the UmbraPay contract to a Midnight network.
 *
 *   npm run deploy -- --network preview
 *   npm run deploy -- --network preprod
 *
 * Without --network it falls back to the active network in .midnight-state.json,
 * then to 'undeployed' (local devnet).
 *
 * WHAT HAPPENS HERE, IN ORDER
 * ----------------------------------------------------------------------------
 *  1. Resolve the network and get (or generate) this network's wallet.
 *     A brand-new wallet prints its 24-word recovery phrase ONCE. Both the
 *     phrase and the derived seed are written to .midnight-state.json, which
 *     is gitignored. Back the phrase up.
 *  2. Sync the wallet against the network. On a public network the first sync
 *     takes minutes.
 *  3. If the balance is zero, print the unshielded address and poll until the
 *     faucet funds it. THIS IS A HUMAN STEP — fund the printed address at the
 *     printed faucet URL. The script waits, it does not do it for you.
 *  4. Register NIGHT for DUST generation and wait for DUST to appear. DUST is
 *     the non-transferable fee resource; no DUST means no transaction.
 *  5. Prove and submit the deployment transaction, then print the contract
 *     address and record it in .midnight-state.json.
 *
 * The constructor argument (the public payroll floor) comes from
 * MIDNIGHT_PAYROLL_FLOOR, defaulting to 1000. The initial private state below
 * is placeholder payroll data for a single employee — a real deployment would
 * supply each recipient's record from their own device.
 */

import * as fs from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { WebSocket } from 'ws';
import * as Rx from 'rxjs';

import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice, recordDeployment } from './network';
import { createWallet, persistWalletState, unshieldedToken } from './wallet';
import { witnesses, type UmbraPayPrivateState } from './witnesses';

// Midnight SDK imports
import { deployContract } from '@midnight-ntwrk/midnight-js-contracts';
import { httpClientProofProvider } from '@midnight-ntwrk/midnight-js-http-client-proof-provider';
import { indexerPublicDataProvider } from '@midnight-ntwrk/midnight-js-indexer-public-data-provider';
import { levelPrivateStateProvider } from '@midnight-ntwrk/midnight-js-level-private-state-provider';
import { NodeZkConfigProvider } from '@midnight-ntwrk/midnight-js-node-zk-config-provider';
import { CompiledContract } from '@midnight-ntwrk/midnight-js-protocol/compact-js';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

/** Identifier under which this contract's private state is stored locally. */
const PRIVATE_STATE_ID = 'umbraPayPrivateState';

/**
 * The published minimum-wage floor, passed to the contract constructor.
 *
 * The constructor parameter is a private circuit input, so the contract
 * discloses it explicitly — this value becomes public, by design.
 */
const PAYROLL_FLOOR = BigInt(process.env.MIDNIGHT_PAYROLL_FLOOR?.trim() || '1000');

/**
 * Placeholder private payroll record for the deploying identity.
 *
 * In production each employee's own device holds its own record and supplies it
 * as the witness at proving time; nothing here is ever published.
 */
const INITIAL_PRIVATE_STATE: UmbraPayPrivateState = {
  salaryAmount: PAYROLL_FLOOR,
  recipientSecret: new Uint8Array(32).fill(0x1a),
  paymentSalt: new Uint8Array(32).fill(0x2b),
};

// Upper bound on the DUST wait. A healthy devnet produces DUST within seconds
// of registration; anything approaching this means the node, the wallet's
// NIGHT balance, or the faucet is the real problem, and failing with that
// message beats hanging.
const DUST_WAIT_TIMEOUT_MS = 5 * 60 * 1000;

const { network, config: networkConfig } = resolveNetwork();
const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

// ─── Proof server readiness ───────────────────────────────────────────────────

async function waitForProofServer(maxAttempts = 60, delayMs = 2000): Promise<boolean> {
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await fetch(networkConfig.proofServer, {
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

// ─── Compiled contract loading ────────────────────────────────────────────────

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const zkConfigPath = path.resolve(__dirname, '..', 'managed', 'counter');
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
// Casting the combinators at this one boundary keeps the rest of this file
// fully typechecked rather than sprinkling `any` through the deploy logic.
const compiledContract = (CompiledContract.make('counter', Counter.Contract) as any).pipe(
  (CompiledContract.withWitnesses as any)(witnesses),
  (CompiledContract.withCompiledFileAssets as any)(zkConfigPath),
);

// ─── Providers ────────────────────────────────────────────────────────────────

async function createProviders(walletCtx: Awaited<ReturnType<typeof createWallet>>) {
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

// ─── Main ─────────────────────────────────────────────────────────────────────

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log(`║  Deploy UmbraPay to ${network}`);
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Payroll floor (public constructor arg): ${PAYROLL_FLOOR}\n`);

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from saved state — sync will resume.`);
  }

  console.log('  Syncing with network...');
  console.log('  ℹ  This may take several minutes depending on network size.');
  console.log('     RPC disconnection messages during sync are normal and can be safely ignored.\n');
  const syncStart = Date.now();
  const syncInterval = setInterval(() => {
    const elapsed = Math.round((Date.now() - syncStart) / 1000);
    process.stdout.write(`\r  ⏳ Still syncing... (${elapsed}s elapsed)   `);
  }, 5000);
  const state = await walletCtx.wallet.waitForSyncedState();
  clearInterval(syncInterval);
  process.stdout.write('\r  ✓ Synced with network.                                      \n');

  await persistWalletState(network, walletCtx);

  const address = walletCtx.unshieldedKeystore.getBech32Address();
  const balance = state.unshielded.balances[unshieldedToken().raw] ?? 0n;
  console.log(`\n  Wallet Address: ${address}`);
  console.log(`  Balance: ${balance.toLocaleString()} tNight\n`);

  if (network === 'undeployed' && balance === 0n) {
    console.error(
      '\n❌ Genesis-seed wallet has zero NIGHT. The devnet preset may not have minted to it.\n' +
        '   Check `docker compose ps` and `docker compose logs node`. Then `docker compose down -v` and retry.\n',
    );
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  // ─── Faucet gate ────────────────────────────────────────────────────────────
  // The wallet has 0 tNIGHT until a human funds the address. This is the single
  // step the script cannot perform for you.
  if (network !== 'undeployed' && networkConfig.faucet) {
    const gateway = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((s) => s.isSynced)));
    const initialTNight = gateway.unshielded.balances[unshieldedToken().raw] ?? 0n;

    if (initialTNight === 0n) {
      console.log('─── FUNDING REQUIRED ───────────────────────────────────────────\n');
      console.log(`  Wallet address: ${address}`);
      console.log(`  Faucet:         ${networkConfig.faucet}`);
      console.log('');
      console.log('  Waiting for tNIGHT to arrive (poll every 10s)...');
      const rawTimeout = Number(process.env.MIDNIGHT_FAUCET_TIMEOUT_MS);
      const timeoutMs = Number.isFinite(rawTimeout) && rawTimeout > 0 ? rawTimeout : 600_000;
      const start = Date.now();
      for (;;) {
        await new Promise((r) => setTimeout(r, 10_000));
        const s = await Rx.firstValueFrom(walletCtx.wallet.state().pipe(Rx.filter((x) => x.isSynced)));
        const tn = s.unshielded.balances[unshieldedToken().raw] ?? 0n;
        if (tn > 0n) {
          console.log(`\n  Funded! tNIGHT balance: ${tn.toLocaleString()}\n`);
          break;
        }
        if (Date.now() - start > timeoutMs) {
          console.log(`\n  ❌ Funding not received within ${Math.round(timeoutMs / 60_000)} min.`);
          console.log(`  Address: ${address}`);
          console.log(`  Faucet:  ${networkConfig.faucet}`);
          console.log('  Re-run `npm run deploy` after funding — your seed is preserved.\n');
          await walletCtx.wallet.stop();
          process.exit(1);
        }
        const elapsed = Math.round((Date.now() - start) / 1000);
        process.stdout.write(`\r  ...still waiting (${elapsed}s elapsed)`);
      }
    }
  }

  // ─── DUST ───────────────────────────────────────────────────────────────────
  console.log('─── DUST Token Setup ───────────────────────────────────────────\n');
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
          Rx.timeout({ first: DUST_WAIT_TIMEOUT_MS }),
        ),
      );
    } catch {
      console.log(`\n  ❌ No DUST generated after ${Math.round(DUST_WAIT_TIMEOUT_MS / 60000)} minutes.\n`);
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

  // ─── Deploy ─────────────────────────────────────────────────────────────────
  console.log('─── Deploy Contract ────────────────────────────────────────────\n');

  console.log('  Checking proof server...');
  if (!(await waitForProofServer())) {
    console.log('\n  ❌ Proof server not responding on ' + networkConfig.proofServer);
    console.log('     Start it with: docker run -p 6300:6300 midnightntwrk/proof-server:8.1.0\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n');

  console.log('  Setting up providers...');
  const providers = await createProviders(walletCtx);

  process.stdout.write('  Generating DUST...');
  await new Promise((r) => setTimeout(r, 6000));
  process.stdout.write(' done.\n');

  console.log('  Deploying contract...\n');

  const MAX_RETRIES = 20;
  const RETRY_DELAY_MS = 5000;
  let deployed: Awaited<ReturnType<typeof deployContract>> | undefined;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      deployed = await deployContract(providers as any, {
        compiledContract: compiledContract as any,
        // The contract's constructor takes the public payroll floor.
        args: [PAYROLL_FLOOR],
        privateStateId: PRIVATE_STATE_ID,
        initialPrivateState: INITIAL_PRIVATE_STATE,
      });
      break;
    } catch (err: any) {
      const errMsg = err?.message || err?.toString() || '';
      const errCause = err?.cause?.message || err?.cause?.toString() || '';
      const fullError = `${errMsg} ${errCause}`;

      const isDustShortage =
        fullError.includes('Not enough Dust') ||
        fullError.includes('Insufficient Funds') ||
        fullError.includes('could not balance dust');

      if (!(isDustShortage && attempt === 1)) {
        console.error(`\n  Attempt ${attempt} error: ${errMsg}`);
        if (errCause && errCause !== errMsg) console.error(`  Cause: ${errCause}`);
      }

      if (
        !isDustShortage &&
        (fullError.includes('Failed to connect to Proof Server') ||
          fullError.includes('connect ECONNREFUSED'))
      ) {
        console.log('  ❌ Proof server unreachable. Start it on port 6300.\n');
        await walletCtx.wallet.stop();
        process.exit(1);
      }

      if (isDustShortage) {
        const currentState = await walletCtx.wallet.waitForSyncedState();
        const dustBalance = currentState.dust.balance(new Date());
        if (attempt < MAX_RETRIES) {
          if (attempt === 1) {
            console.log(`  Still generating DUST, retrying in ${RETRY_DELAY_MS / 1000}s...`);
          } else {
            console.log(
              `  ⏳ DUST balance: ${dustBalance.toLocaleString()} (attempt ${attempt}/${MAX_RETRIES}); retrying in ${RETRY_DELAY_MS / 1000}s...`,
            );
          }
          await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
        } else {
          console.log(`  ❌ Not enough DUST after ${MAX_RETRIES} retries (current: ${dustBalance.toLocaleString()})`);
          await walletCtx.wallet.stop();
          process.exit(1);
        }
      } else {
        throw err;
      }
    }
  }

  if (!deployed) throw new Error('Deployment failed after all retries');

  const contractAddress = deployed.deployTxData.public.contractAddress;
  console.log('  ✅ Contract deployed successfully!\n');
  console.log('  ┌────────────────────────────────────────────────────────────┐');
  console.log(`  │  CONTRACT ADDRESS: ${contractAddress}`);
  console.log('  └────────────────────────────────────────────────────────────┘\n');

  recordDeployment(network, contractAddress, address.toString());
  console.log('  Saved to .midnight-state.json\n');

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();
  console.log('─── Deployment complete ────────────────────────────────────────\n');
  console.log('  Paste the address above into the Contract Address table in README.md.\n');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
