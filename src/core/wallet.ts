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
  try {
    const auth = await transact((wallet) =>
      wallet.authorize({ identity: APP_IDENTITY, chain: CHAIN })
    );
    return {
      status: 'connected',
      session: {
        address: base64AddressToBase58(auth.accounts[0].address),
        authToken: auth.auth_token,
      },
    };
  } catch (e) {
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
  try {
    return await transact(async (wallet) => {
      const auth = await wallet
        .reauthorize({ auth_token: session.authToken, identity: APP_IDENTITY })
        .catch(() =>
          // stale or invalidated token: fresh authorization in the same session
          wallet.authorize({ identity: APP_IDENTITY, chain: CHAIN })
        );
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
