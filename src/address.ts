/**
 * Print this network's wallet address and faucet URL — without syncing.
 *
 *   npm run address -- --network preview
 *
 * The address is derived deterministically from the seed in
 * .midnight-state.json, so it is available instantly. That matters because the
 * full deploy has to sync the wallet against the network first (minutes on a
 * public network), and funding is a human step you can do in parallel.
 *
 * Run the deploy first, or this script will generate the wallet for you and
 * print the same address the deploy will use.
 */

import { Buffer } from 'node:buffer';
import { HDWallet, Roles, createKeystore } from '@midnight-ntwrk/wallet-sdk';
import { getNetworkId, setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';

import { resolveNetwork, getOrCreateWallet, formatWalletBackupNotice } from './network';

const { network, config } = resolveNetwork();
const wallet = getOrCreateWallet(network);

const notice = formatWalletBackupNotice(wallet, network);
if (notice) console.log(notice);

setNetworkId(config.networkId);

const hd = HDWallet.fromSeed(Buffer.from(wallet.seed, 'hex'));
if (hd.type !== 'seedOk') throw new Error('Invalid wallet seed in .midnight-state.json');

const derived = hd.hdWallet
  .selectAccount(0)
  .selectRoles([Roles.NightExternal])
  .deriveKeysAt(0);
if (derived.type !== 'keysDerived') throw new Error('Key derivation failed');
hd.hdWallet.clear();

const keystore = createKeystore(derived.keys[Roles.NightExternal], getNetworkId());
const address = keystore.getBech32Address().toString();

console.log(`\n  Network: ${network}`);
console.log('  ────────────────────────────────────────────────────────────');
console.log(`  Unshielded address (send tNIGHT here):\n    ${address}\n`);
if (config.faucet) {
  console.log(`  Faucet:  ${config.faucet}`);
} else {
  console.log('  Faucet:  n/a (undeployed uses the local devnet genesis wallet)');
}
console.log('  ────────────────────────────────────────────────────────────\n');
console.log('  Fund this address, then run: npm run deploy -- --network ' + network + '\n');
