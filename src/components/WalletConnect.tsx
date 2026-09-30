// ============================================================================
// UmbraPay — WalletConnect component
// ============================================================================
//
// Renders the wallet connection strip at the top of the app:
//
//   Disconnected  → "Connect Lace Wallet" button + short explainer
//   Connecting    → spinner + "Connecting…" message
//   Connected     → wallet address badge + "Disconnect" button
//   Error         → error message + retry button
//
// This component never receives the raw wallet API or any private key
// material — it only sees the sanitised address string and status flags
// from the useMidnight hook.
// ============================================================================

import type { ConnectionStatus } from '../hooks/useMidnight.js';

type Props = {
  status: ConnectionStatus;
  walletAddress: string | null;
  error: string | null;
  onConnect: () => void;
  onDisconnect: () => void;
};

export function WalletConnect({ status, walletAddress, error, onConnect, onDisconnect }: Props) {
  return (
    <section aria-label="Wallet connection" className="wallet-connect">
      {status === 'disconnected' && (
        <div className="wallet-connect__disconnected">
          <p className="wallet-connect__hint">
            Connect your Lace wallet to interact with the UmbraPay contract on Preprod.
          </p>
          <button
            className="btn btn--primary"
            onClick={onConnect}
            aria-label="Connect Lace wallet"
          >
            <span className="btn__icon">🔗</span>
            Connect Lace Wallet
          </button>
        </div>
      )}

      {status === 'connecting' && (
        <div className="wallet-connect__connecting" role="status" aria-live="polite">
          <span className="spinner" aria-hidden="true" />
          <span>Connecting to Lace…</span>
        </div>
      )}

      {status === 'connected' && walletAddress && (
        <div className="wallet-connect__connected">
          <div className="wallet-connect__address">
            <span className="wallet-connect__dot" aria-hidden="true">●</span>
            <span className="wallet-connect__label">Connected</span>
            <code
              className="wallet-connect__addr-text"
              title={walletAddress}
              aria-label={`Wallet address: ${walletAddress}`}
            >
              {truncateAddress(walletAddress)}
            </code>
          </div>
          <button
            className="btn btn--ghost"
            onClick={onDisconnect}
            aria-label="Disconnect wallet"
          >
            Disconnect
          </button>
        </div>
      )}

      {status === 'error' && (
        <div className="wallet-connect__error" role="alert" aria-live="assertive">
          <span className="wallet-connect__error-icon" aria-hidden="true">⚠️</span>
          <span className="wallet-connect__error-msg">{error}</span>
          <button
            className="btn btn--secondary"
            onClick={onConnect}
            aria-label="Retry wallet connection"
          >
            Retry
          </button>
        </div>
      )}
    </section>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Shorten a long wallet address for display.
 * Shows the first 12 and last 8 characters with an ellipsis in the middle.
 */
function truncateAddress(addr: string): string {
  if (addr.length <= 24) return addr;
  return `${addr.slice(0, 12)}…${addr.slice(-8)}`;
}
