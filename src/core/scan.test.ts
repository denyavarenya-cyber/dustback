import { Connection, PublicKey } from '@solana/web3.js';
import {
  EmptyAccount,
  scanWallet,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
  totalRecoverableLamports,
} from './scan';

const OWNER = PublicKey.unique();
const MINT = PublicKey.unique();

const LEGACY_EMPTY_PUBKEY = PublicKey.unique();
const T22_EMPTY_PUBKEY = PublicKey.unique();
const NON_EMPTY_PUBKEY = PublicKey.unique();
const FOREIGN_PUBKEY = PublicKey.unique();

const LEGACY_RENT = 2039280;
const T22_RENT_WITH_EXTENSIONS = 2568240;

function parsedTokenAccount(opts: {
  pubkey: PublicKey;
  lamports: number;
  parsedProgram: string;
  amount: string;
  decimals?: number;
}) {
  return {
    pubkey: opts.pubkey,
    account: {
      lamports: opts.lamports,
      owner: PublicKey.unique(),
      executable: false,
      rentEpoch: 0,
      data: {
        program: opts.parsedProgram,
        space: 165,
        parsed: {
          type: 'account',
          info: {
            mint: MINT.toBase58(),
            owner: OWNER.toBase58(),
            tokenAmount: {
              amount: opts.amount,
              decimals: opts.decimals ?? 6,
            },
          },
        },
      },
    },
  };
}

const legacyAccounts = [
  parsedTokenAccount({
    pubkey: LEGACY_EMPTY_PUBKEY,
    lamports: LEGACY_RENT,
    parsedProgram: 'spl-token',
    amount: '0',
  }),
  parsedTokenAccount({
    pubkey: NON_EMPTY_PUBKEY,
    lamports: LEGACY_RENT,
    parsedProgram: 'spl-token',
    amount: '123456789',
    decimals: 9,
  }),
  // amount "0" but not from the program we queried: must not be swept
  parsedTokenAccount({
    pubkey: FOREIGN_PUBKEY,
    lamports: 999999,
    parsedProgram: 'spl-memo',
    amount: '0',
  }),
];

const token2022Accounts = [
  parsedTokenAccount({
    pubkey: T22_EMPTY_PUBKEY,
    lamports: T22_RENT_WITH_EXTENSIONS,
    parsedProgram: 'spl-token-2022',
    amount: '0',
  }),
];

function mockConnection() {
  const getParsedTokenAccountsByOwner = jest.fn(
    async (_owner: PublicKey, filter: { programId: PublicKey }) => ({
      context: { slot: 1 },
      value: filter.programId.equals(TOKEN_PROGRAM_ID)
        ? legacyAccounts
        : filter.programId.equals(TOKEN_2022_PROGRAM_ID)
          ? token2022Accounts
          : [],
    })
  );
  return {
    connection: { getParsedTokenAccountsByOwner } as unknown as Connection,
    getParsedTokenAccountsByOwner,
  };
}

describe('scanWallet', () => {
  it('queries both token programs', async () => {
    const { connection, getParsedTokenAccountsByOwner } = mockConnection();
    await scanWallet(connection, OWNER);

    expect(getParsedTokenAccountsByOwner).toHaveBeenCalledTimes(2);
    const queriedPrograms = getParsedTokenAccountsByOwner.mock.calls.map(
      ([, filter]) => filter.programId.toBase58()
    );
    expect(queriedPrograms).toContain(TOKEN_PROGRAM_ID.toBase58());
    expect(queriedPrograms).toContain(TOKEN_2022_PROGRAM_ID.toBase58());
  });

  it('classifies empty accounts with their actual lamports', async () => {
    const { connection } = mockConnection();
    const result = await scanWallet(connection, OWNER);

    expect(result.emptyAccounts).toEqual([
      {
        pubkey: LEGACY_EMPTY_PUBKEY.toBase58(),
        program: 'token',
        lamports: LEGACY_RENT,
      },
      {
        pubkey: T22_EMPTY_PUBKEY.toBase58(),
        program: 'token2022',
        lamports: T22_RENT_WITH_EXTENSIONS,
      },
    ]);
  });

  it('classifies non-empty accounts with raw amount and decimals', async () => {
    const { connection } = mockConnection();
    const result = await scanWallet(connection, OWNER);

    expect(result.nonEmptyAccounts).toEqual([
      {
        pubkey: NON_EMPTY_PUBKEY.toBase58(),
        mint: MINT.toBase58(),
        program: 'token',
        amountRaw: '123456789',
        decimals: 9,
      },
    ]);
  });

  it('ignores zero-amount accounts from unexpected programs', async () => {
    const { connection } = mockConnection();
    const result = await scanWallet(connection, OWNER);

    const allPubkeys = [
      ...result.emptyAccounts.map((a) => a.pubkey),
      ...result.nonEmptyAccounts.map((a) => a.pubkey),
    ];
    expect(allPubkeys).not.toContain(FOREIGN_PUBKEY.toBase58());
  });
});

describe('totalRecoverableLamports', () => {
  it('sums lamports across empty accounts', () => {
    const empties: EmptyAccount[] = [
      { pubkey: 'a', program: 'token', lamports: LEGACY_RENT },
      { pubkey: 'b', program: 'token2022', lamports: T22_RENT_WITH_EXTENSIONS },
    ];
    expect(totalRecoverableLamports(empties)).toBe(
      LEGACY_RENT + T22_RENT_WITH_EXTENSIONS
    );
  });

  it('returns 0 for no accounts', () => {
    expect(totalRecoverableLamports([])).toBe(0);
  });
});
