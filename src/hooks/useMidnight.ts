// ============================================================================
// UmbraPay — useMidnight React hook
// ============================================================================
//
// Central state machine for:
//   - Lace wallet connection / disconnection
//   - Circuit calls (proveAboveFloor and commitPayout)
//   - Loading, error, and result state exposed to components
//
// PRIVACY RULE: private inputs (salary, secret, salt) flow INTO the lib
// functions in midnight-browser.ts and are NEVER stored in this hook's state
// or returned up to the component tree.
// ============================================================================

import { useCallback, useReducer } from 'react';
import {
  connectWallet,
  callProveAboveFloor,
  callCommitPayout,
  type WalletInfo,
  type TxResult,
} from '../lib/midnight-browser.js';

// ---------------------------------------------------------------------------
// State shape
// ---------------------------------------------------------------------------

export type ConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'error';
export type CircuitStatus = 'idle' | 'proving' | 'submitting' | 'done' | 'error';

export type MidnightState = {
  connectionStatus: ConnectionStatus;
  /** Wallet address shown in UI — safe to display. */
  walletAddress: string | null;
  /** Internal wallet info — NOT exposed to render output. */
  _walletInfo: WalletInfo | null;
  connectionError: string | null;

  circuitStatus: CircuitStatus;
  circuitError: string | null;
  /** Last successful transaction result. */
  txResult: TxResult | null;
};

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

type Action =
  | { type: 'CONNECT_START' }
  | { type: 'CONNECT_OK'; wallet: WalletInfo }
  | { type: 'CONNECT_ERR'; message: string }
  | { type: 'DISCONNECT' }
  | { type: 'CIRCUIT_PROVING' }
  | { type: 'CIRCUIT_SUBMITTING' }
  | { type: 'CIRCUIT_OK'; result: TxResult }
  | { type: 'CIRCUIT_ERR'; message: string };

// ---------------------------------------------------------------------------
// Reducer
// ---------------------------------------------------------------------------

const initial: MidnightState = {
  connectionStatus: 'disconnected',
  walletAddress: null,
  _walletInfo: null,
  connectionError: null,
  circuitStatus: 'idle',
  circuitError: null,
  txResult: null,
};

function reducer(state: MidnightState, action: Action): MidnightState {
  switch (action.type) {
    case 'CONNECT_START':
      return { ...state, connectionStatus: 'connecting', connectionError: null };

    case 'CONNECT_OK':
      return {
        ...state,
        connectionStatus: 'connected',
        walletAddress: action.wallet.address,
        _walletInfo: action.wallet,
        connectionError: null,
      };

    case 'CONNECT_ERR':
      return {
        ...state,
        connectionStatus: 'error',
        walletAddress: null,
        _walletInfo: null,
        connectionError: action.message,
      };

    case 'DISCONNECT':
      return { ...initial };

    case 'CIRCUIT_PROVING':
      return {
        ...state,
        circuitStatus: 'proving',
        circuitError: null,
        txResult: null,
      };

    case 'CIRCUIT_SUBMITTING':
      return { ...state, circuitStatus: 'submitting' };

    case 'CIRCUIT_OK':
      return { ...state, circuitStatus: 'done', txResult: action.result, circuitError: null };

    case 'CIRCUIT_ERR':
      return { ...state, circuitStatus: 'error', circuitError: action.message };

    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useMidnight() {
  const [state, dispatch] = useReducer(reducer, initial);

  // ── Wallet connect ──────────────────────────────────────────────────────
  const connect = useCallback(async () => {
    dispatch({ type: 'CONNECT_START' });
    try {
      const wallet = await connectWallet();
      dispatch({ type: 'CONNECT_OK', wallet });
    } catch (err: unknown) {
      dispatch({
        type: 'CONNECT_ERR',
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }, []);

  // ── Wallet disconnect ───────────────────────────────────────────────────
  const disconnect = useCallback(() => {
    dispatch({ type: 'DISCONNECT' });
  }, []);

  // ── Circuit: proveAboveFloor ────────────────────────────────────────────
  //
  // The caller passes a salary value; private inputs (secret, salt) are
  // generated inside callProveAboveFloor and never surface here.
  const proveAboveFloor = useCallback(
    async (salaryAmount: bigint) => {
      if (!state._walletInfo) return;
      dispatch({ type: 'CIRCUIT_PROVING' });
      try {
        const result = await callProveAboveFloor(state._walletInfo, salaryAmount);
        dispatch({ type: 'CIRCUIT_OK', result });
      } catch (err: unknown) {
        dispatch({
          type: 'CIRCUIT_ERR',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [state._walletInfo],
  );

  // ── Circuit: commitPayout ───────────────────────────────────────────────
  const commitPayout = useCallback(
    async (salaryAmount: bigint) => {
      if (!state._walletInfo) return;
      dispatch({ type: 'CIRCUIT_PROVING' });
      try {
        const result = await callCommitPayout(state._walletInfo, salaryAmount);
        dispatch({ type: 'CIRCUIT_OK', result });
      } catch (err: unknown) {
        dispatch({
          type: 'CIRCUIT_ERR',
          message: err instanceof Error ? err.message : String(err),
        });
      }
    },
    [state._walletInfo],
  );

  return {
    // Connection state
    connectionStatus: state.connectionStatus,
    walletAddress: state.walletAddress,
    connectionError: state.connectionError,
    isConnected: state.connectionStatus === 'connected',
    isConnecting: state.connectionStatus === 'connecting',

    // Circuit state
    circuitStatus: state.circuitStatus,
    circuitError: state.circuitError,
    txResult: state.txResult,
    isProving: state.circuitStatus === 'proving',
    isSubmitting: state.circuitStatus === 'submitting',
    isBusy: state.circuitStatus === 'proving' || state.circuitStatus === 'submitting',

    // Actions
    connect,
    disconnect,
    proveAboveFloor,
    commitPayout,
  };
}
