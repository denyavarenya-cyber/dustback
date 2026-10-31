// Writes the JSON fixtures in this folder. Deterministic: same output every run.
// Usage (from packages/cleanup-core): node test/fixtures/generate.mjs
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { getBase58Decoder, getBase58Encoder } from '@solana/kit';

const here = dirname(fileURLToPath(import.meta.url));
const b58 = getBase58Decoder();
const b58bytes = getBase58Encoder();

/** A synthetic address that belongs to no one: sha256 of a label. */
export function fake(label) {
  return b58.decode(createHash('sha256').update(`noventia-fixture:${label}`).digest());
}

const TOKEN = 'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA';
const TOKEN_2022 = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
const WSOL = 'So11111111111111111111111111111111111111112';
const JUP = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';
const ATA = 'ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL';
const SYSTEM = '11111111111111111111111111111111';
const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111';
const ALT_PROGRAM = 'AddressLookupTab1e1111111111111111111111111';
// u64::MAX as the RPC prints it; JSON numbers round it the same way.
const RENT_EPOCH_MAX = 2 ** 64 - 1;
const U64_MAX_BIG = 2n ** 64n - 1n;
const RENT_165 = 2039280;
const RENT_170 = 2074080;
const RENT_182 = 2157600;

const OWNER = fake('owner');
const FEE_WALLET = fake('fee-wallet');

function ui(amount, decimals) {
  const n = Number(amount) / 10 ** decimals;
  return { amount: String(amount), decimals, uiAmount: n, uiAmountString: String(n) };
}

/** One entry of getTokenAccountsByOwner with encoding jsonParsed. */
function entry({ label, mint, amount = 0, decimals = 6, program = 'token', lamports, state = 'initialized', extra = {} }) {
  const programId = program === 'token' ? TOKEN : TOKEN_2022;
  const space = extra.space ?? (program === 'token' ? 165 : 170);
  delete extra.space;
  return {
    pubkey: fake(label),
    account: {
      data: {
        parsed: {
          info: { isNative: false, mint, owner: OWNER, state, tokenAmount: ui(amount, decimals), ...extra },
          type: 'account',
        },
        program: program === 'token' ? 'spl-token' : 'spl-token-2022',
        space,
      },
      executable: false,
      lamports: lamports ?? (program === 'token' ? RENT_165 : RENT_170),
      owner: programId,
      rentEpoch: RENT_EPOCH_MAX,
      space,
    },
  };
}

function write(name, value) {
  writeFileSync(join(here, name), `${JSON.stringify(value, null, 2)}\n`);
}

const notes = 'Synthetic data in the exact JSON-RPC format. Not a real wallet.';

// 1. Empty wallet
write('wallet-empty.json', { notes, owner: OWNER, token: [], token2022: [], prices: {} });

// 2. Fifty dust accounts: small balances priced under the 5 USD threshold
{
  const token = [];
  const prices = {};
  for (let i = 0; i < 50; i++) {
    const mint = fake(`dust-mint-${i}`);
    token.push(entry({ label: `dust-${i}`, mint, amount: 1000 * (i + 1), decimals: 6 }));
    prices[mint] = 0.01 * (i + 1); // value = 0.001*(i+1) * 0.01*(i+1) USD, at most 0.025 USD
  }
  write('wallet-dust50.json', { notes, owner: OWNER, token, token2022: [], prices });
}

// 3. Frozen accounts: one empty, one with a balance
write('wallet-frozen.json', {
  notes,
  owner: OWNER,
  token: [
    entry({ label: 'frozen-empty', mint: fake('frozen-mint'), state: 'frozen' }),
    entry({ label: 'frozen-balance', mint: fake('frozen-mint-2'), amount: 500000, state: 'frozen' }),
    entry({ label: 'plain-empty', mint: fake('plain-mint') }),
  ],
  token2022: [],
  prices: { [fake('frozen-mint-2')]: 0.000001 },
});

// 4. Token-2022: withheld fees, a confidential balance, a foreign close authority, an unknown extension
{
  const withheld = entry({
    label: 't22-withheld',
    mint: fake('t22-fee-mint'),
    program: 'token2022',
    lamports: RENT_182,
    extra: {
      space: 182,
      extensions: [
        { extension: 'immutableOwner' },
        { extension: 'transferFeeAmount', state: { withheldAmount: 15 } },
      ],
    },
  });
  const zeroWithheld = entry({
    label: 't22-no-withheld',
    mint: fake('t22-fee-mint'),
    program: 'token2022',
    lamports: RENT_182,
    extra: {
      space: 182,
      extensions: [
        { extension: 'immutableOwner' },
        { extension: 'transferFeeAmount', state: { withheldAmount: 0 } },
      ],
    },
  });
  const confidential = entry({
    label: 't22-confidential',
    mint: fake('t22-ct-mint'),
    program: 'token2022',
    lamports: 2853600,
    extra: {
      space: 282,
      extensions: [{ extension: 'immutableOwner' }, { extension: 'confidentialTransferAccount', state: { approved: true } }],
    },
  });
  const foreignClose = entry({
    label: 't22-close-authority',
    mint: fake('t22-plain-mint'),
    program: 'token2022',
    extra: { closeAuthority: fake('someone-else'), extensions: [{ extension: 'immutableOwner' }] },
  });
  const unknownExt = entry({
    label: 't22-unknown-ext',
    mint: fake('t22-plain-mint'),
    program: 'token2022',
    extra: { extensions: [{ extension: 'immutableOwner' }, { extension: 'someFutureExtension' }] },
  });
  write('wallet-token2022.json', {
    notes,
    owner: OWNER,
    token: [],
    token2022: [withheld, zeroWithheld, confidential, foreignClose, unknownExt],
    prices: {},
  });
}

// 5. NFTs: a plain NFT, a frozen programmable NFT, and an empty account of a sold NFT
write('wallet-nft.json', {
  notes,
  owner: OWNER,
  token: [
    entry({ label: 'nft', mint: fake('nft-mint'), amount: 1, decimals: 0 }),
    entry({ label: 'pnft', mint: fake('pnft-mint'), amount: 1, decimals: 0, state: 'frozen' }),
    entry({ label: 'sold-nft', mint: fake('sold-nft-mint'), amount: 0, decimals: 0 }),
  ],
  token2022: [],
  // Even a price must not make an NFT swappable or burnable.
  prices: { [fake('nft-mint')]: 0.001 },
});

// 6. Seventy empty accounts: more than fits in one transaction
{
  const token = [];
  const token2022 = [];
  for (let i = 0; i < 50; i++) token.push(entry({ label: `many-${i}`, mint: fake(`many-mint-${i}`) }));
  for (let i = 0; i < 20; i++) {
    token2022.push(
      entry({
        label: `many22-${i}`,
        mint: fake(`many22-mint-${i}`),
        program: 'token2022',
        extra: { extensions: [{ extension: 'immutableOwner' }] },
      }),
    );
  }
  write('wallet-many-empty.json', { notes, owner: OWNER, token, token2022, prices: {} });
}

// 7. Mixed wallet used by the swap tests
const SWAP_MINT = fake('swap-mint');
const USDC = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v';
const wrapped = entry({ label: 'wsol', mint: WSOL, amount: 50000000, decimals: 9, lamports: 52039280 });
wrapped.account.data.parsed.info.isNative = true;
wrapped.account.data.parsed.info.rentExemptReserve = ui(2039280, 9);
// Malformed or foreign entries: must be skipped, never acted on
const foreign = entry({ label: 'not-mine', mint: fake('x') });
foreign.account.data.parsed.info.owner = fake('stranger');
write('wallet-mixed.json', {
  notes,
  owner: OWNER,
  token: [
    entry({ label: 'swap-input', mint: SWAP_MINT, amount: 123456789, decimals: 5 }),
    entry({ label: 'usdc', mint: USDC, amount: 250000000, decimals: 6 }),
    entry({ label: 'mixed-empty', mint: fake('mixed-empty-mint') }),
    wrapped,
    foreign,
    { pubkey: 'not-an-address', account: {} },
  ],
  token2022: [],
  prices: { [SWAP_MINT]: 0.00002, [USDC]: 1 },
});

// 8. Jupiter /swap/v2/build response for selling the swap-input balance
const FEE_ACCOUNT = fake('fee-wallet-wsol-account');
const USER_WSOL_ATA = fake('owner-wsol-ata');
const POOLS = [fake('pool-1'), fake('pool-2'), fake('pool-3'), fake('pool-4')];
const ALT = fake('lookup-table');
const ix = (programId, accounts, data) => ({
  programId,
  accounts: accounts.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
  data: Buffer.from(data).toString('base64'),
});
const u64 = (n) => {
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(BigInt(n));
  return [...b];
};
write('jupiter-build.json', {
  notes: 'Synthetic data in the documented /swap/v2/build format.',
  inputMint: SWAP_MINT,
  outputMint: WSOL,
  inAmount: '123456789',
  outAmount: '2100000',
  otherAmountThreshold: '2079000',
  swapMode: 'ExactIn',
  slippageBps: 100,
  priceImpactPct: '0.0004',
  routePlan: [
    {
      swapInfo: { ammKey: POOLS[0], label: 'Whirlpool', inputMint: SWAP_MINT, outputMint: WSOL, inAmount: '123456789', outAmount: '2110500' },
      percent: 100,
      bps: 10000,
    },
  ],
  computeBudgetInstructions: [ix(COMPUTE_BUDGET, [], [3, ...u64(50000)])],
  setupInstructions: [
    ix(ATA, [[OWNER, true, true], [USER_WSOL_ATA, false, true], [OWNER, false, false], [WSOL, false, false], [SYSTEM, false, false], [TOKEN, false, false]], [1]),
  ],
  swapInstruction: ix(
    JUP,
    [
      [TOKEN, false, false],
      [OWNER, true, false],
      [fake('swap-input'), false, true],
      [USER_WSOL_ATA, false, true],
      [FEE_ACCOUNT, false, true],
      [POOLS[0], false, true],
      [POOLS[1], false, true],
      [POOLS[2], false, false],
      [POOLS[3], false, false],
      [SWAP_MINT, false, false],
      [WSOL, false, false],
    ],
    [229, 23, 203, 151, 122, 227, 173, 42, 1, 0, 0, 0, 7, 100, 0, 1, ...u64(123456789), ...u64(2079000), 100, 0, 50],
  ),
  cleanupInstruction: ix(TOKEN, [[USER_WSOL_ATA, false, true], [OWNER, false, true], [OWNER, true, false]], [9]),
  otherInstructions: [],
  tipInstruction: null,
  addressesByLookupTableAddress: { [ALT]: POOLS },
  transactionVersion: 0,
  blockhashWithMetadata: { blockhash: [1, 2, 3], lastValidBlockHeight: 1000, fetchedAt: { secs_since_epoch: 0, nanos_since_epoch: 0 } },
});

// 9. The lookup table account as getMultipleAccounts (base64) returns it
{
  const header = Buffer.alloc(56);
  header.writeUInt32LE(1, 0);
  header.writeBigUInt64LE(U64_MAX_BIG, 4);
  header.writeBigUInt64LE(1000n, 12);
  const body = Buffer.concat(POOLS.map((p) => Buffer.from(b58bytes.encode(p))));
  write('lookup-table.json', {
    notes,
    address: ALT,
    account: { data: [Buffer.concat([header, body]).toString('base64'), 'base64'], executable: false, lamports: 1586880, owner: ALT_PROGRAM, rentEpoch: RENT_EPOCH_MAX, space: 56 + 32 * POOLS.length },
  });
}

// 10. The fee wallet's wrapped SOL token account (getAccountInfo, jsonParsed)
{
  const fee = entry({ label: 'fee-wallet-wsol-account', mint: WSOL, amount: 5000000, decimals: 9, lamports: 7039280 });
  fee.account.data.parsed.info.owner = FEE_WALLET;
  fee.account.data.parsed.info.isNative = true;
  fee.account.data.parsed.info.rentExemptReserve = ui(2039280, 9);
  write('fee-account.json', { notes, address: FEE_ACCOUNT, value: fee.account });
}

write('addresses.json', {
  notes,
  owner: OWNER,
  feeWallet: FEE_WALLET,
  feeAccount: FEE_ACCOUNT,
  userWsolAta: USER_WSOL_ATA,
  swapMint: SWAP_MINT,
  swapInput: fake('swap-input'),
  usdcAccount: fake('usdc'),
  wsolAccount: fake('wsol'),
  lookupTable: ALT,
  pools: POOLS,
  stranger: fake('stranger'),
});
