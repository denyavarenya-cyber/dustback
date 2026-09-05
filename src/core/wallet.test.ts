jest.mock('@solana-mobile/mobile-wallet-adapter-protocol-web3js', () => ({
  transact: jest.fn(),
}));

import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-web3js';
import {
  classifyConnectFailure,
  classifySignFailure,
  signAndSendTransactions,
} from './wallet';

const mockTransact = transact as jest.MockedFunction<typeof transact>;

function withCode(code: unknown): Error {
  return Object.assign(new Error('mwa failure'), { code });
}

const AUTH_RESULT = {
  accounts: [{ address: Buffer.alloc(32).toString('base64') }],
  auth_token: 'fresh-token',
  wallet_uri_base: '',
};

function fakeWallet() {
  return {
    reauthorize: jest.fn(async () => AUTH_RESULT),
    authorize: jest.fn(async () => AUTH_RESULT),
    signAndSendTransactions: jest.fn(async () => ['sig1']),
  };
}

describe('classifyConnectFailure', () => {
  it.each([
    ['ERROR_SESSION_CLOSED'],
    ['ERROR_SESSION_TIMEOUT'],
    ['ERROR_ASSOCIATION_CANCELLED'],
  ])('maps %s to interrupted', (code) => {
    expect(classifyConnectFailure(withCode(code))).toBe('interrupted');
  });

  it('maps a CancellationException to interrupted', () => {
    expect(
      classifyConnectFailure(
        new Error('java.util.concurrent.CancellationException')
      )
    ).toBe('interrupted');
  });

  it('maps an unknown rejection without a decline code to interrupted', () => {
    expect(classifyConnectFailure(new Error('something else'))).toBe(
      'interrupted'
    );
    expect(classifyConnectFailure(undefined)).toBe('interrupted');
  });

  it('keeps a user decline on the silent cancelled path', () => {
    expect(classifyConnectFailure(withCode(-1))).toBe('cancelled');
  });

  it('keeps wallet-not-found distinct', () => {
    expect(classifyConnectFailure(withCode('ERROR_WALLET_NOT_FOUND'))).toBe(
      'no-wallet'
    );
  });
});

describe('classifySignFailure', () => {
  it.each([[-1], [-3], ['ERROR_NOT_SIGNED']])(
    'maps decline code %s to declined',
    (code) => {
      expect(classifySignFailure(withCode(code))).toBe('declined');
    }
  );

  it.each([
    ['ERROR_SESSION_CLOSED'],
    ['ERROR_SESSION_TIMEOUT'],
    ['ERROR_ASSOCIATION_CANCELLED'],
  ])('maps %s to session', (code) => {
    expect(classifySignFailure(withCode(code))).toBe('session');
  });

  it('maps a CancellationException message to session', () => {
    expect(
      classifySignFailure(
        new Error('java.util.concurrent.CancellationException: cancelled')
      )
    ).toBe('session');
  });

  it('leaves unknown sign errors unclassified', () => {
    expect(classifySignFailure(new Error('other'))).toBeNull();
  });
});

describe('signAndSendTransactions session reuse', () => {
  it('authorizes fresh when the stored token was cleared', async () => {
    const wallet = fakeWallet();
    mockTransact.mockImplementation(async (cb) => cb(wallet as never));

    const result = await signAndSendTransactions(
      { address: 'addr', authToken: '' },
      []
    );

    expect(wallet.authorize).toHaveBeenCalledTimes(1);
    expect(wallet.reauthorize).not.toHaveBeenCalled();
    expect(result.session.authToken).toBe('fresh-token');
  });

  it('reauthorizes with a stored token when one is present', async () => {
    const wallet = fakeWallet();
    mockTransact.mockImplementation(async (cb) => cb(wallet as never));

    await signAndSendTransactions({ address: 'addr', authToken: 'tok' }, []);

    expect(wallet.reauthorize).toHaveBeenCalledWith(
      expect.objectContaining({ auth_token: 'tok' })
    );
    expect(wallet.authorize).not.toHaveBeenCalled();
  });
});
