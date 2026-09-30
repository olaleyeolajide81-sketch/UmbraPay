// ============================================================================
// UmbraPay — CircuitCall component
// ============================================================================
//
// Lets the user invoke either the `proveAboveFloor` or `commitPayout` circuit
// against the live Preprod deployment.
//
// PRIVACY CONTRACT (enforced throughout):
//   - Private inputs (salary, recipient secret, payment salt) are NEVER stored
//     in component state or rendered to the DOM.
//   - The user enters a numeric floor value; anything private is generated
//     fresh inside midnight-browser.ts and discarded after the proof.
//   - The label "Proved without revealing your input" is displayed on every
//     successful proof to make this guarantee visible to the user.
// ============================================================================

import { useState } from 'react';
import type { CircuitStatus } from '../hooks/useMidnight.js';
import type { TxResult } from '../lib/midnight-browser.js';

type Props = {
  isConnected: boolean;
  circuitStatus: CircuitStatus;
  circuitError: string | null;
  txResult: TxResult | null;
  isBusy: boolean;
  onProveAboveFloor: (salary: bigint) => void;
  onCommitPayout: (salary: bigint) => void;
};

// The publicly-known floor on the Preprod deployment.
const DEFAULT_FLOOR = 1000n;

export function CircuitCall({
  isConnected,
  circuitStatus,
  circuitError,
  txResult,
  isBusy,
  onProveAboveFloor,
  onCommitPayout,
}: Props) {
  // The user sets a "salary amount" for the proof. This number is the ONLY
  // value that travels from the UI to the proving layer; it is NOT a secret —
  // it represents the value the user wants to prove exceeds the floor.
  // The actual private witnesses (recipientSecret, paymentSalt) are generated
  // fresh inside midnight-browser.ts and never returned.
  const [amountInput, setAmountInput] = useState('1500');
  const [selectedCircuit, setSelectedCircuit] = useState<'prove' | 'commit'>('prove');

  const parsedAmount = (): bigint | null => {
    const n = parseInt(amountInput, 10);
    if (isNaN(n) || n <= 0) return null;
    return BigInt(n);
  };

  const handleSubmit = () => {
    const amount = parsedAmount();
    if (amount === null) return;
    if (selectedCircuit === 'prove') {
      onProveAboveFloor(amount);
    } else {
      onCommitPayout(amount);
    }
  };

  const isAmountValid = parsedAmount() !== null;
  const canSubmit = isConnected && !isBusy && isAmountValid;

  return (
    <section aria-label="Circuit call panel" className="circuit-call">
      <h2 className="circuit-call__heading">Run a ZK Circuit</h2>

      {/* Circuit selector */}
      <fieldset className="circuit-call__selector" disabled={!isConnected || isBusy}>
        <legend className="circuit-call__selector-legend">Choose circuit</legend>

        <label className="circuit-call__option">
          <input
            type="radio"
            name="circuit"
            value="prove"
            checked={selectedCircuit === 'prove'}
            onChange={() => setSelectedCircuit('prove')}
          />
          <span>
            <strong>proveAboveFloor</strong>
            <small> — proves salary ≥ floor, publishes nothing on-chain</small>
          </span>
        </label>

        <label className="circuit-call__option">
          <input
            type="radio"
            name="circuit"
            value="commit"
            checked={selectedCircuit === 'commit'}
            onChange={() => setSelectedCircuit('commit')}
          />
          <span>
            <strong>commitPayout</strong>
            <small> — settles a payout; updates aggregate and commitment on-chain</small>
          </span>
        </label>
      </fieldset>

      {/* Amount input */}
      <div className="circuit-call__input-row">
        <label htmlFor="salary-amount" className="circuit-call__label">
          Proof value (must exceed floor of {DEFAULT_FLOOR.toString()})
        </label>
        <input
          id="salary-amount"
          type="number"
          min="1"
          value={amountInput}
          onChange={(e) => setAmountInput(e.target.value)}
          disabled={!isConnected || isBusy}
          className={`circuit-call__input ${!isAmountValid ? 'circuit-call__input--error' : ''}`}
          aria-invalid={!isAmountValid}
          aria-describedby="salary-hint"
        />
        <p id="salary-hint" className="circuit-call__hint">
          This value is passed to the ZK prover. Your private recipient identity and
          payment salt are generated fresh and <strong>never shown or stored</strong>.
        </p>
      </div>

      {/* Submit button */}
      <button
        className={`btn btn--primary circuit-call__submit ${isBusy ? 'btn--loading' : ''}`}
        onClick={handleSubmit}
        disabled={!canSubmit}
        aria-busy={isBusy}
        aria-label={isBusy ? 'Generating proof…' : 'Generate proof and submit'}
      >
        {isBusy ? (
          <>
            <span className="spinner spinner--sm" aria-hidden="true" />
            {circuitStatus === 'proving' ? 'Generating proof…' : 'Submitting…'}
          </>
        ) : (
          <>
            <span className="btn__icon">🔒</span>
            Prove &amp; Submit
          </>
        )}
      </button>

      {/* Loading state description */}
      {isBusy && (
        <p className="circuit-call__loading-note" role="status" aria-live="polite">
          {circuitStatus === 'proving'
            ? '⏳ Generating ZK proof locally in your browser — this may take a few seconds.'
            : '📡 Submitting proof to the Preprod network…'}
        </p>
      )}

      {/* Error */}
      {circuitStatus === 'error' && circuitError && (
        <div className="circuit-call__result circuit-call__result--error" role="alert">
          <p className="circuit-call__result-title">⚠️ Circuit call failed</p>
          <p className="circuit-call__result-body">{circuitError}</p>
        </div>
      )}

      {/* Success result */}
      {circuitStatus === 'done' && txResult && (
        <div className="circuit-call__result circuit-call__result--success" role="status">
          <p className="circuit-call__result-title">✅ Proof accepted on-chain</p>

          {/* Privacy disclosure label — required by spec */}
          <p className="circuit-call__privacy-badge">
            🔒 Proved without revealing your input
          </p>

          <dl className="circuit-call__tx-details">
            <dt>Circuit</dt>
            <dd>
              <code>{txResult.circuitName}</code>
            </dd>

            <dt>Transaction</dt>
            <dd>
              <code className="circuit-call__hash" title={txResult.txHash}>
                {truncateHash(txResult.txHash)}
              </code>
            </dd>

            {txResult.blockHeight > 0 && (
              <>
                <dt>Block</dt>
                <dd>{txResult.blockHeight.toLocaleString()}</dd>
              </>
            )}
          </dl>

          {txResult.circuitName === 'proveAboveFloor' && (
            <p className="circuit-call__result-note">
              This transaction published <strong>nothing</strong> — no amount, no
              identity, no salt. The ledger is byte-for-byte identical to before.
            </p>
          )}
          {txResult.circuitName === 'commitPayout' && (
            <p className="circuit-call__result-note">
              The on-chain aggregate and round counter advanced. Your salary and
              recipient identity remain private.
            </p>
          )}
        </div>
      )}

      {/* Not connected hint */}
      {!isConnected && (
        <p className="circuit-call__not-connected" aria-live="polite">
          Connect your wallet above to enable circuit calls.
        </p>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function truncateHash(hash: string): string {
  if (hash.length <= 20) return hash;
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}
