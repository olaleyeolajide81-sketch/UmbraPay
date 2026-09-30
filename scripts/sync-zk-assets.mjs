// ============================================================================
// UmbraPay — publish the compiled ZK artifacts for the browser
// ============================================================================
//
// The proving keys, verifier keys and ZKIRs that `compact compile` writes into
// managed/counter/ are the same artifacts the deploy scripts read off disk. The
// frontend cannot read disk, so it fetches them over HTTP — and the URL layout
// is fixed by Midnight.js's FetchZkConfigProvider, which requests exactly:
//
//   <base>/keys/<circuit>.prover
//   <base>/keys/<circuit>.verifier
//   <base>/zkir/<circuit>.bzkir
//
// So the artifacts have to be served from a directory that mirrors that shape.
// This script copies managed/counter/{keys,zkir} into public/zk/, which Vite
// copies verbatim into the build output and serves at /zk/ in dev.
//
// managed/ stays the single source of truth; public/zk/ is generated, and is
// gitignored so the (multi-megabyte) keys are not committed twice.
//
// This runs automatically via the `predev` and `prebuild` npm scripts, so
// `npm run dev` and `npm run build` never serve a stale or missing artifact set.

import { cp, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const source = path.join(root, 'managed', 'counter');
const destination = path.join(root, 'public', 'zk');

const compiledContracts = path.join(source, 'contract', 'index.js');
if (!existsSync(compiledContracts)) {
  console.error(
    '\n❌ No compiled contract found at managed/counter/contract/index.js.\n' +
      '   Run `npm run compact` first (needs the Compact toolchain in .compact-version).\n',
  );
  process.exit(1);
}

// Rebuild from scratch so a circuit removed from the contract cannot linger as
// a stale artifact the browser would happily fetch.
await rm(destination, { recursive: true, force: true });
await mkdir(destination, { recursive: true });

for (const directory of ['keys', 'zkir']) {
  const from = path.join(source, directory);
  if (!existsSync(from)) {
    console.error(`\n❌ Missing ${path.relative(root, from)} — the contract is not fully compiled.\n`);
    process.exit(1);
  }
  await cp(from, path.join(destination, directory), { recursive: true });
}

console.log(`✓ Published ZK artifacts to ${path.relative(root, destination)}/`);
