import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import { defineConfig } from 'vite';

// The frontend bundles the Midnight ledger, which ships as a WebAssembly module
// (`@midnight-ntwrk/ledger-v8`) and is loaded for its side effects. The settings
// below exist to handle that module correctly:
//
//   vite-plugin-wasm    handles the .wasm import in ledger-v8 that the default
//                       Rollup bundler cannot process.
//   target: 'esnext'   the wasm glue uses top-level await, which the
//                       default es2015-ish targets refuse to lower.
//   optimizeDeps.exclude the wasm is instantiated at import time, so the
//                       dependency pre-bundler must not rewrite it into a
//                       CommonJS-ish interop wrapper.
export default defineConfig({
  plugins: [wasm(), react()],
  build: {
    target: 'esnext',
  },
  optimizeDeps: {
    esbuildOptions: { target: 'esnext' },
    exclude: ['@midnight-ntwrk/ledger-v8'],
  },
});
