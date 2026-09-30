// ============================================================================
// UmbraPay — App root
// ============================================================================

import { WalletConnect } from './components/WalletConnect.js';
import { CircuitCall } from './components/CircuitCall.js';
import { useMidnight } from './hooks/useMidnight.js';
import { CONTRACT_ADDRESS } from './lib/midnight-browser.js';

export function App() {
  const {
    // Connection
    connectionStatus,
    walletAddress,
    connectionError,
    isConnected,
    connect,
    disconnect,

    // Circuit
    circuitStatus,
    circuitError,
    txResult,
    isBusy,
    proveAboveFloor,
    commitPayout,
  } = useMidnight();

  return (
    <div className="app">
      {/* ── Header ──────────────────────────────────────────────────── */}
      <header className="app__header">
        <div className="app__header-inner">
          <div className="app__logo">
            <span className="app__logo-icon" aria-hidden="true">🌙</span>
            <h1 className="app__title">UmbraPay</h1>
          </div>
          <p className="app__tagline">
            Payroll that proves it is fair without revealing who earns what.
          </p>
        </div>
      </header>

      {/* ── Main content ────────────────────────────────────────────── */}
      <main className="app__main">

        {/* Wallet connection strip */}
        <WalletConnect
          status={connectionStatus}
          walletAddress={walletAddress}
          error={connectionError}
          onConnect={connect}
          onDisconnect={disconnect}
        />

        {/* Circuit call panel */}
        <CircuitCall
          isConnected={isConnected}
          circuitStatus={circuitStatus}
          circuitError={circuitError}
          txResult={txResult}
          isBusy={isBusy}
          onProveAboveFloor={proveAboveFloor}
          onCommitPayout={commitPayout}
        />

        {/* Privacy model info card */}
        <section aria-label="Privacy model" className="privacy-card">
          <h2 className="privacy-card__heading">Privacy Model</h2>

          <div className="privacy-card__grid">
            <div className="privacy-card__col">
              <h3 className="privacy-card__col-title privacy-card__col-title--public">
                🔓 PUBLIC — visible on-chain
              </h3>
              <ul className="privacy-card__list">
                <li>Payroll round counter</li>
                <li>Total disbursed (aggregate)</li>
                <li>Minimum wage floor</li>
                <li>Payout commitment hash</li>
              </ul>
            </div>

            <div className="privacy-card__col">
              <h3 className="privacy-card__col-title privacy-card__col-title--private">
                🔒 PRIVATE — never on-chain
              </h3>
              <ul className="privacy-card__list">
                <li>Individual salary amount</li>
                <li>Recipient identity</li>
                <li>Per-payment salt</li>
              </ul>
            </div>
          </div>

          <p className="privacy-card__claim">
            <strong>Privacy Claim:</strong> An on-chain observer sees that a payout
            happened, that it cleared the floor, and what the aggregate moved to. They
            cannot determine the individual salary, who received it, or link two payouts
            to the same person. Private inputs are proven locally in your browser and
            are never transmitted.
          </p>
        </section>

        {/* Contract info footer card */}
        <section aria-label="Contract information" className="contract-card">
          <h2 className="contract-card__heading">Live Contract — Preprod</h2>
          <dl className="contract-card__details">
            <dt>Network</dt>
            <dd>Midnight Preprod</dd>
            <dt>Contract address</dt>
            <dd>
              <code className="contract-card__address">{CONTRACT_ADDRESS}</code>
            </dd>
          </dl>
        </section>
      </main>

      {/* ── Footer ──────────────────────────────────────────────────── */}
      <footer className="app__footer">
        <p>
          UmbraPay — built on{' '}
          <a
            href="https://midnight.network"
            target="_blank"
            rel="noopener noreferrer"
          >
            Midnight
          </a>{' '}
          for the Midnight Builder Challenge •{' '}
          <a
            href="https://github.com/olaleyeolajide81-sketch/UmbraPay"
            target="_blank"
            rel="noopener noreferrer"
          >
            GitHub
          </a>
        </p>
      </footer>
    </div>
  );
}
