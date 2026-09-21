// ============================================================================
// UmbraPay — contract test suite
// ============================================================================
//
// Covers the three things the Level 1 spec asks for:
//
//   1. CIRCUIT LOGIC      — does each circuit do what it claims, including
//                           rejecting inputs that violate the public floor?
//   2. STATE TRANSITIONS  — does the public ledger move the way it should
//                           across successive payouts?
//   3. PRIVACY            — do the private inputs ever reach the ledger?
//
// Group 3 is the one that matters most for UmbraPay, so it does not assert on
// intent. It reads the actual `Ledger` object the contract produced and
// searches its bytes for the private values.
//
// ============================================================================

import { describe, expect, it } from 'vitest';
import type { Ledger } from '../managed/counter/contract/index.js';
import { UmbraPaySimulator } from './counter-simulator.js';

// ── helpers ──────────────────────────────────────────────────────────────────

/** A 32-byte array filled with a single distinctive value. */
const bytes32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

/** Big-endian 32-byte encoding, matching how the contract types a `Uint<64>`. */
const bigintTo32Bytes = (value: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let remaining = value;
  for (let i = 31; i >= 0 && remaining > 0n; i--) {
    out[i] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
};

/** Flatten every public ledger field into one byte blob for substring searches. */
const ledgerBytes = (l: Ledger): Uint8Array => {
  const parts = [
    bigintTo32Bytes(l.payrollRound),
    bigintTo32Bytes(l.totalDisbursed),
    bigintTo32Bytes(l.payrollFloor),
    l.lastPayoutCommitment,
  ];
  const total = parts.reduce((n, p) => n + p.length, 0);
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** Does `haystack` contain `needle` as a contiguous subsequence? */
const containsSubsequence = (haystack: Uint8Array, needle: Uint8Array): boolean => {
  if (needle.length === 0 || needle.length > haystack.length) return false;
  outer: for (let i = 0; i <= haystack.length - needle.length; i++) {
    for (let j = 0; j < needle.length; j++) {
      if (haystack[i + j] !== needle[j]) continue outer;
    }
    return true;
  }
  return false;
};

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

/** Zero-pad a short string into 32 bytes, mirroring Compact's `pad(32, s)`. */
const padTo32 = (value: string): Uint8Array => {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(value).slice(0, 32), 0);
  return out;
};

const FLOOR = 1_000n;
const GENESIS_COMMITMENT = toHex(padTo32('umbrapay:genesis'));

// ── 1. circuit logic ─────────────────────────────────────────────────────────

describe('UmbraPay circuit logic', () => {
  it('settles a payout and moves the public aggregate by exactly the private amount', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 4_000n,
      recipientSecret: bytes32(0xa1),
      paymentSalt: bytes32(0x5e),
    });

    expect(sim.getLedger().totalDisbursed).toBe(0n);

    const { commitment, ledger: next } = await sim.commitPayout();

    expect(next.totalDisbursed).toBe(4_000n);
    // the commitment the circuit returned is the one it published
    expect(toHex(commitment)).toBe(toHex(next.lastPayoutCommitment));
  });

  it('rejects a payout below the public floor without revealing the salary', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 999n, // one unit below the floor
      recipientSecret: bytes32(0xb2),
      paymentSalt: bytes32(0x6f),
    });

    await expect(sim.commitPayout()).rejects.toThrow(/below the public payroll floor/i);

    // the failed attempt left no trace on the public ledger
    const after = sim.getLedger();
    expect(after.totalDisbursed).toBe(0n);
    expect(after.payrollRound).toBe(1n);
  });

  it('accepts a payout exactly at the floor (boundary is inclusive)', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: FLOOR,
      recipientSecret: bytes32(0xc3),
      paymentSalt: bytes32(0x70),
    });

    const { ledger: next } = await sim.commitPayout();
    expect(next.totalDisbursed).toBe(FLOOR);
  });

  it('proves the salary clears the floor while publishing nothing at all', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 7_500n,
      recipientSecret: bytes32(0xd4),
      paymentSalt: bytes32(0x81),
    });

    const before = sim.getLedger();
    const after = await sim.proveAboveFloor();

    // a pure zero-knowledge assertion: byte-for-byte identical ledger
    expect(after.totalDisbursed).toBe(before.totalDisbursed);
    expect(after.payrollRound).toBe(before.payrollRound);
    expect(toHex(after.lastPayoutCommitment)).toBe(toHex(before.lastPayoutCommitment));
  });

  it('rejects a floor proof when the salary does not clear the floor', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 5n,
      recipientSecret: bytes32(0xe5),
      paymentSalt: bytes32(0x92),
    });

    await expect(sim.proveAboveFloor()).rejects.toThrow(/below the public payroll floor/i);
  });

  it('computes remaining budget from public state alone', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 3_000n,
      recipientSecret: bytes32(0xf6),
      paymentSalt: bytes32(0xa3),
    });

    expect(await sim.remainingBudget(10_000n)).toBe(10_000n);

    await sim.commitPayout();
    expect(await sim.remainingBudget(10_000n)).toBe(7_000n);

    await expect(sim.remainingBudget(2_999n)).rejects.toThrow(/budget already exceeded/i);
  });
});

// ── 2. state transitions ─────────────────────────────────────────────────────

describe('UmbraPay state transitions', () => {
  it('initialises the ledger with the disclosed floor, a zero aggregate, and an open round', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: 2_500n,
      salaryAmount: 5_000n,
      recipientSecret: bytes32(0x11),
      paymentSalt: bytes32(0x22),
    });

    const initial = sim.getLedger();
    expect(initial.payrollFloor).toBe(2_500n); // disclosed on purpose in the constructor
    expect(initial.totalDisbursed).toBe(0n);
    expect(initial.payrollRound).toBe(1n);
    expect(toHex(initial.lastPayoutCommitment)).toBe(GENESIS_COMMITMENT);
  });

  it('initialises deterministically across independent deployments', async () => {
    const make = () =>
      UmbraPaySimulator.create({
        floor: FLOOR,
        salaryAmount: 5_000n,
        recipientSecret: bytes32(0x33),
        paymentSalt: bytes32(0x44),
      });

    const [a, b] = await Promise.all([make(), make()]);
    expect(a.getLedger()).toEqual(b.getLedger());
  });

  it('accumulates the aggregate and advances one round per payout', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 4_000n,
      recipientSecret: bytes32(0x55),
      paymentSalt: bytes32(0x66),
    });

    await sim.commitPayout(); // employee A: 4000

    // next recipient — only the private inputs change
    sim.setPrivateState({
      salaryAmount: 6_000n,
      recipientSecret: bytes32(0x77),
      paymentSalt: bytes32(0x88),
    });
    await sim.commitPayout(); // employee B: 6000

    const final = sim.getLedger();
    expect(final.totalDisbursed).toBe(10_000n);
    expect(final.payrollRound).toBe(3n); // 1 from the constructor + 2 payouts
  });

  it('produces a reproducible commitment for identical private inputs', async () => {
    const build = async () => {
      const sim = await UmbraPaySimulator.create({
        floor: FLOOR,
        salaryAmount: 4_321n,
        recipientSecret: bytes32(0x99),
        paymentSalt: bytes32(0xaa),
      });
      return (await sim.commitPayout()).commitment;
    };

    expect(toHex(await build())).toBe(toHex(await build()));
  });
});

// ── 3. private inputs are never exposed ──────────────────────────────────────

describe('UmbraPay privacy guarantees', () => {
  it('never writes any private input to the public ledger', async () => {
    const recipientSecret = bytes32(0xcc);
    const paymentSalt = bytes32(0xdd);

    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 4_000n,
      recipientSecret,
      paymentSalt,
    });
    await sim.commitPayout();

    const serialized = ledgerBytes(sim.getLedger());
    expect(containsSubsequence(serialized, recipientSecret)).toBe(false);
    expect(containsSubsequence(serialized, paymentSalt)).toBe(false);
  });

  it('exposes only the four declared public fields on the ledger', async () => {
    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: 4_000n,
      recipientSecret: bytes32(0xee),
      paymentSalt: bytes32(0xff),
    });
    await sim.commitPayout();

    // no witness-named key ever reaches public state
    expect(Object.keys(sim.getLedger()).sort()).toEqual([
      'lastPayoutCommitment',
      'payrollFloor',
      'payrollRound',
      'totalDisbursed',
    ]);
  });

  it('does not publish an individual salary anywhere in the ledger bytes', async () => {
    const SALARY_A = 4_000n;
    const SALARY_B = 6_000n;

    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: SALARY_A,
      recipientSecret: bytes32(0x12),
      paymentSalt: bytes32(0x34),
    });
    await sim.commitPayout();

    sim.setPrivateState({
      salaryAmount: SALARY_B,
      recipientSecret: bytes32(0x56),
      paymentSalt: bytes32(0x78),
    });
    await sim.commitPayout();

    const serialized = ledgerBytes(sim.getLedger());

    // The aggregate IS published — that is the deliberate disclosure.
    expect(sim.getLedger().totalDisbursed).toBe(SALARY_A + SALARY_B);

    // But neither individual amount appears in the published bytes, in the
    // same 32-byte big-endian form the contract uses internally for amounts.
    expect(containsSubsequence(serialized, bigintTo32Bytes(SALARY_A))).toBe(false);
    expect(containsSubsequence(serialized, bigintTo32Bytes(SALARY_B))).toBe(false);

    // The aggregate is 10000 — so 4000 and 6000 cannot be recovered from it
    // without knowing the split, which never left the prover's device.
  });

  it('keeps two equal salaries unlinkable via per-payment salt', async () => {
    const SALARY = 5_000n;

    const first = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: SALARY,
      recipientSecret: bytes32(0x9a),
      paymentSalt: bytes32(0x0b),
    });
    const second = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: SALARY,
      recipientSecret: bytes32(0x9a),
      paymentSalt: bytes32(0x0c), // only the salt differs
    });

    const a = await first.commitPayout();
    const b = await second.commitPayout();

    // identical salary and recipient, yet the published commitments do not match,
    // so an observer cannot cluster equal earners off the ledger
    expect(toHex(a.commitment)).not.toBe(toHex(b.commitment));
    expect(a.commitment.length).toBe(32);
  });

  it('keeps the private state off the ledger and restorable from the local record', async () => {
    const employeeA = {
      salaryAmount: 12_345n,
      recipientSecret: bytes32(0x1f),
      paymentSalt: bytes32(0x2e),
    };
    const employeeB = {
      salaryAmount: 54_321n,
      recipientSecret: bytes32(0x3d),
      paymentSalt: bytes32(0x4c),
    };

    const sim = await UmbraPaySimulator.create({ floor: FLOOR, ...employeeA });
    await sim.commitPayout();

    // settling a payout does not mutate the private record the user holds
    expect(sim.getPrivateState()).toEqual(employeeA);

    sim.setPrivateState(employeeB);
    await sim.commitPayout();

    const published = ledgerBytes(sim.getLedger());
    for (const record of [employeeA, employeeB]) {
      expect(containsSubsequence(published, record.recipientSecret)).toBe(false);
      expect(containsSubsequence(published, record.paymentSalt)).toBe(false);
      expect(containsSubsequence(published, bigintTo32Bytes(record.salaryAmount))).toBe(false);
    }

    // two participants, one published aggregate — the split stays private
    expect(sim.getLedger().totalDisbursed).toBe(employeeA.salaryAmount + employeeB.salaryAmount);
  });

  it('documents a known Level 1 limit: a one-participant payroll exposes that salary via the aggregate', async () => {
    const ONLY_SALARY = 12_345n;

    const sim = await UmbraPaySimulator.create({
      floor: FLOOR,
      salaryAmount: ONLY_SALARY,
      recipientSecret: bytes32(0x1f),
      paymentSalt: bytes32(0x2e),
    });
    await sim.commitPayout();

    // This is EXPECTED, and it is the honest cost of publishing the aggregate:
    // `totalDisbursed` is a deliberate disclosure, so with exactly one payee the
    // aggregate IS that payee's salary. The commitment keeps the recipient
    // private, but not the amount.
    //
    // A real payroll always has several participants, so the split is hidden.
    // A payroll of one — a founder paying only themselves — leaks. Level 2
    // addresses this with decoy payouts and batched disclosure windows.
    expect(sim.getLedger().totalDisbursed).toBe(ONLY_SALARY);
    expect(containsSubsequence(ledgerBytes(sim.getLedger()), bigintTo32Bytes(ONLY_SALARY))).toBe(
      true,
    );
  });
});
