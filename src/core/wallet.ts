import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import { PublicKey, Transaction } from '@solana/web3.js';

const APP_IDENTITY = {
  name: 'Sweeper',
  uri: 'https://sweeper.app',
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
  | { status: 'no-wallet' };

function base64AddressToBase58(address: string): string {
  return new PublicKey(Buffer.from(address, 'base64')).toBase58();
}

function classify(e: unknown): 'no-wallet' | 'cancelled' | null {
  const code = (e as { code?: unknown } | null)?.code;
  if (code === 'ERROR_WALLET_NOT_FOUND') return 'no-wallet';
  if (
    code === 'ERROR_ASSOCIATION_CANCELLED' ||
    code === 'ERROR_SESSION_CLOSED' ||
    code === -1 // ERROR_AUTHORIZATION_FAILED: user declined
  ) {
    return 'cancelled';
  }
  return null;
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
    const kind = classify(e);
    if (kind !== null) return { status: kind };
    throw e;
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

function classifySignFailure(e: unknown): SignFailure | null {
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
  transactions: Transaction[]
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
      throw new WalletSignError(
        'session',
        'Wallet session failed — reconnect and try again'
      );
    }
    throw e;
  }
}
