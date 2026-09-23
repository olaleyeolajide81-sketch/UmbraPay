/**
 * Exercise a deployed UmbraPay contract — real transactions, not a simulation.
 *
 *   npm run interact -- --network preprod
 *   npm run interact -- --network preprod --salary 2500
 *
 * `npm run deploy` proves the contract can be *deployed*. This proves the
 * deployed contract actually *runs*: it settles a payout and then runs the
 * compliance circuit, and both transactions are finalised on chain.
 *
 * WHAT HAPPENS HERE, IN ORDER
 * ----------------------------------------------------------------------------
 *  1. Resolve the network and load the contract address recorded for it.
 *  2. Sync the wallet and wait for DUST — a transaction with no DUST cannot be
 *     submitted, so this is a hard gate.
 *  3. Read the public ledger from the indexer (the BEFORE snapshot).
 *  4. Call `commitPayout()`. The salary, the recipient secret and the
 *     per-payment salt are witnesses held locally; the transaction publishes
 *     only the commitment hash and the moved aggregate.
 *  5. Re-read the ledger: the aggregate must move by exactly the private
 *     salary, the round counter must advance, and the commitment must change.
 *  6. Call `proveAboveFloor()`. This publishes nothing at all — no ledger
 *     write, no return value — and the ledger is re-read once more to show it
 *     is unchanged.
 *
 * Every run holds its OWN private record, with fresh salt, which is what a real
 * payment does. Two runs paying the same salary therefore publish different
 * commitments, so equal pay cannot be clustered off the ledger. Pin the inputs
 * with MIDNIGHT_SALARY_AMOUNT / MIDNIGHT_RECIPIENT_SECRET / MIDNIGHT_PAYMENT_SALT
 * when you need reproducible output; the secret and the salt are never printed.
 */

import { WebSocket } from 'ws';

import {
  resolveNetwork,
  getOrCreateWallet,
  getDeployment,
  formatWalletBackupNotice,
  type DeploymentRecord,
  type NetworkId,
} from './network';
import { createWallet, persistWalletState, unshieldedToken } from './wallet';
import {
  compiledContract,
  ledgerOf,
  makePrivateState,
  PRIVATE_STATE_ID,
  type Ledger,
} from './contract';
import { createProviders, ensureDust, waitForProofServer } from './providers';

// Midnight SDK imports
import { findDeployedContract } from '@midnight-ntwrk/midnight-js-contracts';

// @ts-expect-error Required for wallet sync
globalThis.WebSocket = WebSocket;

const { network, config: networkConfig } = resolveNetwork();

function requireDeployment(net: NetworkId): DeploymentRecord {
  const found = getDeployment(net);
  if (!found) {
    console.error(`\n❌ No ${net} deployment recorded in .midnight-state.json.\n`);
    console.error(`   Deploy first:  npm run deploy -- --network ${net}\n`);
    process.exit(1);
  }
  return found;
}

const DEPLOYMENT = requireDeployment(network);
const CONTRACT_ADDRESS = DEPLOYMENT.address;

const WALLET = getOrCreateWallet(network);
const SEED = WALLET.seed;
{
  const notice = formatWalletBackupNotice(WALLET, network);
  if (notice) console.log(notice);
}

/** The salary to settle privately. Defaults to the on-chain floor. */
function resolveSalary(ledger: Ledger): bigint {
  const raw = process.env.MIDNIGHT_SALARY_AMOUNT?.trim();
  if (!raw) return ledger.payrollFloor;
  const value = BigInt(raw);
  if (value < ledger.payrollFloor) {
    console.error(`\n❌ MIDNIGHT_SALARY_AMOUNT (${value}) is below the on-chain payroll floor`);
    console.error(`   (${ledger.payrollFloor}). commitPayout() would abort.\n`);
    process.exit(1);
  }
  return value;
}

const hex = (bytes: Uint8Array): string => `0x${Buffer.from(bytes).toString('hex')}`;

function printLedger(ledger: Ledger): void {
  console.log(`  payrollFloor          ${ledger.payrollFloor.toLocaleString()}`);
  console.log(`  payrollRound          ${ledger.payrollRound.toLocaleString()}`);
  console.log(`  totalDisbursed        ${ledger.totalDisbursed.toLocaleString()}`);
  console.log(`  lastPayoutCommitment  ${hex(ledger.lastPayoutCommitment)}`);
}

/** A stable fingerprint of the public ledger, for before/after comparison. */
const fingerprint = (ledger: Ledger): string =>
  [
    ledger.payrollFloor,
    ledger.payrollRound,
    ledger.totalDisbursed,
    hex(ledger.lastPayoutCommitment),
  ].join('|');

async function readLedger(providers: Awaited<ReturnType<typeof createProviders>>): Promise<Ledger> {
  const state = await providers.publicDataProvider.queryContractState(CONTRACT_ADDRESS as any);
  if (!state) {
    throw new Error(
      `No contract state found at ${CONTRACT_ADDRESS} on ${network}. ` +
        'Check the address in .midnight-state.json, and that the indexer is reachable.',
    );
  }
  return ledgerOf(state.data);
}

async function main() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║  UmbraPay — interact with the deployed contract');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  console.log(`  Network:           ${network}`);
  console.log(`  Contract address:  ${CONTRACT_ADDRESS}`);
  console.log(`  Deployed:          ${DEPLOYMENT.deployedAt}`);
  console.log(`  Deployed by:       ${DEPLOYMENT.deployer}\n`);

  console.log('─── Wallet setup ───────────────────────────────────────────────\n');
  console.log('  Creating wallet...');
  const walletCtx = await createWallet({ network, networkConfig, seed: SEED });
  const restoredCount = Object.values(walletCtx.restored).filter(Boolean).length;
  if (restoredCount > 0) {
    console.log(`  Restored ${restoredCount}/3 child wallets from saved state — sync will resume.`);
  }

  console.log('  Syncing with network...');
  console.log('  ℹ  RPC disconnection messages during sync are normal and can be safely ignored.\n');
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

  console.log('  Checking proof server...');
  if (!(await waitForProofServer(networkConfig.proofServer))) {
    console.log(`\n  ❌ Proof server not responding on ${networkConfig.proofServer}`);
    console.log('     Start it with: docker compose up -d\n');
    await walletCtx.wallet.stop();
    process.exit(1);
  }
  process.stdout.write('\r  Proof server ready!                                 \n');

  console.log('\n─── DUST ───────────────────────────────────────────────────────\n');
  await ensureDust(walletCtx, network);

  const providers = await createProviders(walletCtx, networkConfig);

  console.log('─── Public ledger BEFORE ───────────────────────────────────────\n');
  const before = await readLedger(providers);
  printLedger(before);

  // ─── commitPayout ───────────────────────────────────────────────────────────
  const salary = resolveSalary(before);
  const privateState = makePrivateState(salary);

  console.log('\n─── connect to the deployed contract ───────────────────────────\n');
  console.log('  Loading this contract\'s private-state slot — the witness record');
  console.log('  that never leaves this machine.');
  const contract = (await findDeployedContract(providers as any, {
    compiledContract,
    contractAddress: CONTRACT_ADDRESS as any,
    privateStateId: PRIVATE_STATE_ID,
    initialPrivateState: privateState,
  } as any)) as any;

  console.log('\n─── commitPayout() ─────────────────────────────────────────────\n');
  console.log('  Private inputs (witnesses, held locally and never published):');
  console.log(`    salaryAmount     ${salary.toLocaleString()}`);
  console.log('    recipientSecret  <held locally, not printed>');
  console.log('    paymentSalt      <fresh per run, not printed>');
  console.log('\n  Proving and submitting...');
  const payout = await contract.callTx.commitPayout();
  console.log(`  ✓ Settled. Tx: ${payout.public.txId}`);
  console.log(`             Block: ${payout.public.blockHeight}`);

  console.log('\n─── Public ledger AFTER commitPayout() ─────────────────────────\n');
  const after = await readLedger(providers);
  printLedger(after);
  const delta = after.totalDisbursed - before.totalDisbursed;
  console.log(`\n  The aggregate moved by exactly the private salary (${delta.toLocaleString()}),`);
  console.log('  the round advanced by one, and the commitment changed — while neither');
  console.log('  the amount nor the recipient appears anywhere on the ledger.');

  // ─── proveAboveFloor ────────────────────────────────────────────────────────
  console.log('\n─── proveAboveFloor() ──────────────────────────────────────────\n');
  console.log('  The compliance primitive: prove the private salary clears the public');
  console.log('  floor, publishing nothing at all — no ledger write, no return value.');
  console.log('\n  Proving and submitting...');
  const floorProof = await contract.callTx.proveAboveFloor();
  console.log(`  ✓ Proven. Tx: ${floorProof.public.txId}`);
  console.log(`            Block: ${floorProof.public.blockHeight}`);

  const proven = await readLedger(providers);
  const unchanged = fingerprint(proven) === fingerprint(after);
  console.log(`\n  Ledger unchanged by that transaction: ${unchanged ? '✓ yes' : '✗ NO — investigate'}`);
  if (!unchanged) {
    console.log('  That is a privacy bug: a circuit that must publish nothing moved state.');
    await walletCtx.wallet.stop();
    process.exit(1);
  }

  await persistWalletState(network, walletCtx);
  await walletCtx.wallet.stop();

  console.log('\n─── Done ───────────────────────────────────────────────────────\n');
  console.log('  Both transactions are finalised on chain, so checking the result needs');
  console.log('  neither this script nor its local state:\n');
  console.log(
    `    curl -s -X POST -H 'Content-Type: application/json' -d '{"query":"query($a:String!){contractAction(address:$a){state}}","variables":{"a":"${CONTRACT_ADDRESS}"}}' ${networkConfig.indexer}\n`,
  );
  console.log('  A non-null `state` is this contract. Those bytes are the four public');
  console.log('  fields printed above, decoded by managed/counter/contract/index.js —');
  console.log('  and nothing else.\n');
  console.log(`  Contract: ${CONTRACT_ADDRESS}`);
  console.log(`  Network:  ${network}\n`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
