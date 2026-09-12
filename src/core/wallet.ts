import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  PublicKey,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';

const APP_IDENTITY = {
  name: 'DustBack',
  uri: 'https://dustback.app',
  icon: 'favicon.png',
};
const CHAIN = 'solana:mainnet-beta';

// dev-only MWA tracing; flip to false to silence without a rebuild
const DEBUG_MWA = typeof __DEV__ !== 'undefined' && __DEV__;

function maskToken(token: string): string {
  return token === '' ? '(empty)' : `${token.slice(0, 6)}…(${token.length})`;
}

function serializeError(e: unknown): Record<string, unknown> {
  if (e instanceof Error) {
    return {
      name: e.name,
      message: e.message,
      code: (e as { code?: unknown }).code,
      data: (e as { data?: unknown }).data,
      raw: JSON.stringify(e, Object.getOwnPropertyNames(e)),
    };
  }
  return { raw: JSON.stringify(e) };
}

function mwaLog(event: string, details: Record<string, unknown>): void {
  if (!DEBUG_MWA) return;
  console.log(`[mwa] ${event} ${JSON.stringify(details)}`);
}

export interface WalletSession {
  address: string;
  authToken: string;
}

export type ConnectResult =
  | { status: 'connected'; session: WalletSession }
  | { status: 'cancelled' }
  | { status: 'no-wallet' }
  | { status: 'interrupted' };

function base64AddressToBase58(address: string): string {
  return new PublicKey(Buffer.from(address, 'base64')).toBase58();
}

/** Anything that is not a wallet-missing or an explicit user decline is a
 *  session-level interruption (vendor battery policy killing the app switch,
 *  timeouts, dropped associations). */
export function classifyConnectFailure(
  e: unknown
): 'no-wallet' | 'cancelled' | 'interrupted' {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'ERROR_WALLET_NOT_FOUND') return 'no-wallet';
  if (code === -1) return 'cancelled'; // ERROR_AUTHORIZATION_FAILED: declined
  return 'interrupted';
}

export async function connect(): Promise<ConnectResult> {
  mwaLog('connect.transact', { method: 'authorize', identity: APP_IDENTITY });
  try {
    const auth = await transact((wallet) =>
      wallet.authorize({ identity: APP_IDENTITY, chain: CHAIN })
    );
    mwaLog('connect.authorized', {
      authToken: maskToken(auth.auth_token),
      accounts: auth.accounts.length,
    });
    return {
      status: 'connected',
      session: {
        address: base64AddressToBase58(auth.accounts[0].address),
        authToken: auth.auth_token,
      },
    };
  } catch (e) {
    mwaLog('connect.failed', { error: serializeError(e) });
    return { status: classifyConnectFailure(e) };
  }
}

export type SignFailure = 'declined' | 'session';

export class WalletSignError extends Error {
  constructor(
    public readonly kind: SignFailure,
    message: string
  ) {
    super(message);
    this.name = 'WalletSignError';
  }
}

export function classifySignFailure(e: unknown): SignFailure | null {
  const code = (e as { code?: unknown } | null)?.code;
  const message = e instanceof Error ? e.message : '';
  if (
    code === -1 || // ERROR_AUTHORIZATION_FAILED: user declined authorization
    code === -3 || // ERROR_NOT_SIGNED: user declined signing
    code === 'ERROR_NOT_SIGNED'
  ) {
    return 'declined';
  }
  if (
    code === 'ERROR_SESSION_CLOSED' ||
    code === 'ERROR_SESSION_TIMEOUT' ||
    code === 'ERROR_ASSOCIATION_CANCELLED' ||
    message.includes('CancellationException')
  ) {
    return 'session';
  }
  return null;
}

export async function signAndSendTransactions(
  session: WalletSession,
  transactions: (Transaction | VersionedTransaction)[]
): Promise<{ signatures: string[]; session: WalletSession }> {
  mwaLog('sign.transact', {
    hasAuthToken: session.authToken !== '',
    authToken: maskToken(session.authToken),
    identity: APP_IDENTITY,
    txCount: transactions.length,
  });
  try {
    return await transact(async (wallet) => {
      // MWA 2.0: authorize with auth_token replaces the deprecated
      // reauthorize and silently reauthorizes while the token is valid.
      // An empty token (interrupted session) authorizes fresh directly;
      // a rejected token is discarded per spec and retried fresh.
      const auth = session.authToken
        ? await wallet
            .authorize({
              identity: APP_IDENTITY,
              chain: CHAIN,
              auth_token: session.authToken,
            })
            .catch((e) => {
              mwaLog('sign.tokenAuthorize.rejected', {
                error: serializeError(e),
              });
              return wallet.authorize({ identity: APP_IDENTITY, chain: CHAIN });
            })
        : await wallet.authorize({ identity: APP_IDENTITY, chain: CHAIN });
      mwaLog('sign.authorized', {
        tokenRotated: auth.auth_token !== session.authToken,
        authToken: maskToken(auth.auth_token),
      });
      const signatures = await wallet.signAndSendTransactions({ transactions });
      return {
        signatures,
        session: {
          address: base64AddressToBase58(auth.accounts[0].address),
          authToken: auth.auth_token,
        },
      };
    });
  } catch (e) {
    mwaLog('sign.failed', { error: serializeError(e) });
    const kind = classifySignFailure(e);
    if (kind === 'declined') {
      throw new WalletSignError('declined', 'Request declined in wallet');
    }
    if (kind === 'session') {
      throw new WalletSignError('session', 'Wallet session failed. Try again.');
    }
    throw e;
  }
}
