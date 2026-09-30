import { defineConfig } from 'vitest/config';

// Vitest configuration for the UmbraPay test suite.
//
// The 16 tests in tests/counter.test.ts run the compiled Compact contract
// in-process through compact-runtime — no Docker, no proof server, no wallet,
// no network. They complete in well under a second on any modern machine.
//
// Timeout: the default 5 000 ms is plenty for in-process circuit execution,
// but an accidental async hang (e.g., a promise that never resolves because
// compact-runtime changes its API to async) would take 5 s per test to surface.
// 10 000 ms gives headroom for slow CI runners while still failing fast.
//
// Reporter: 'verbose' prints each test name and its pass/fail status, which
// makes the CI log self-documenting. The Level 1 spec requires a screenshot of
// a terminal showing "3+ passing" — verbose makes that trivially readable.

export default defineConfig({
  test: {
    // Only pick up tests under tests/ — avoids accidentally running
    // anything in managed/ or node_modules that happens to match *.test.*
    include: ['tests/**/*.test.ts'],

    // Run each test file in a Node.js worker (the default for Vitest).
    // compact-runtime is a pure Node module, so there is no need for
    // jsdom or happy-dom here.
    environment: 'node',

    // Per-test timeout in milliseconds. In-process circuit execution is fast;
    // this is a safety net against async hangs rather than a real performance
    // constraint.
    testTimeout: 10_000,

    // Print each test name alongside its result. Makes CI logs and the
    // Level 1 demo screenshot both self-documenting.
    reporters: ['verbose'],

    // Pool strategy: 'forks' gives each test file its own Node process,
    // preventing any global state from compact-runtime bleeding between suites.
    pool: 'forks',
  },
});
