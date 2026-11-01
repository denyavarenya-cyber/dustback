import { describe, expect, it } from 'vitest';
import { createConfig } from '../src/config';
import {
  ASSOCIATED_TOKEN_PROGRAM,
  COMPUTE_BUDGET_PROGRAM,
  GENESIS_HASH,
  JUPITER_AGGREGATOR_PROGRAM,
  SYSTEM_PROGRAM,
  TOKEN_PROGRAM,
  WSOL_MINT,
} from '../src/constants';
import { isCleanupError } from '../src/errors';
import { prepareSwap } from '../src/swap';
import type { ScanResult } from '../src/scan';
import {
  ADDR,
  baseHandlers,
  decodeTx,
  fakeRpc,
  fixture,
  NOW,
  rawAccount,
  scanFixture,
  simErr,
  simOk,
  testConfig,
  tokenAccountData,
  u64At,
} from './helpers';

interface Ix {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: string;
}
type Json = Record<string, unknown> & {
  setupInstructions: Ix[];
  otherInstructions: Ix[];
  swapInstruction: Ix;
  cleanupInstruction: Ix;
  computeBudgetInstructions: Ix[];
};

const build = () => fixture<Json>('jupiter-build.json');
const lookupTable = fixture<{ address: string; account: { data: [string, string] } & Record<string, unknown> }>('lookup-table.json');
const feeAccount = fixture<{ value: unknown }>('fee-account.json');
const TABLES = { [ADDR.lookupTable]: ADDR.pools };

const IN_AMOUNT = 123456789n;
const OWNER_BEFORE = 1_000_000_000;
const FEE_BEFORE = 5_000_000n;
const MEASURED_FEE = 10_500n;

const b64 = (bytes: number[]) => Buffer.from(bytes).toString('base64');
const ix = (programId: string, accounts: [string, boolean, boolean][], data: number[]) => ({
  programId,
  accounts: accounts.map(([pubkey, isSigner, isWritable]) => ({ pubkey, isSigner, isWritable })),
  data: b64(data),
});

interface Setup {
  jupiter?: Json;
  feeAfter?: bigint;
  inputAfter?: bigint;
  simFails?: boolean;
  table?: unknown;
  feeAccountValue?: unknown;
  genesis?: string;
}

function world(s: Setup = {}) {
  const urls: string[] = [];
  const fetchImpl = (async (url: string) => {
    urls.push(url);
    return new Response(JSON.stringify(s.jupiter ?? build()), { status: 200 });
  }) as unknown as typeof fetch;
  const before = (addr: string) => {
    if (addr === ADDR.owner) return rawAccount(OWNER_BEFORE, SYSTEM_PROGRAM);
    if (addr === ADDR.swapInput) return rawAccount(2039280, TOKEN_PROGRAM, tokenAccountData(ADDR.swapMint, ADDR.owner, IN_AMOUNT));
    if (addr === ADDR.feeAccount) return rawAccount(7039280, TOKEN_PROGRAM, tokenAccountData(WSOL_MINT, ADDR.feeWallet, FEE_BEFORE));
    if (addr === ADDR.lookupTable) return s.table === undefined ? lookupTable.account : s.table;
    return null;
  };
  const after = (addr: string) => {
    if (addr === ADDR.owner) return rawAccount(OWNER_BEFORE + 2_079_000 - 5000, SYSTEM_PROGRAM);
    if (addr === ADDR.swapInput) {
      return rawAccount(2039280, TOKEN_PROGRAM, tokenAccountData(ADDR.swapMint, ADDR.owner, s.inputAfter ?? 0n));
    }
    if (addr === ADDR.feeAccount) {
      return rawAccount(7039280, TOKEN_PROGRAM, tokenAccountData(WSOL_MINT, ADDR.feeWallet, s.feeAfter ?? FEE_BEFORE + MEASURED_FEE));
    }
    return null;
  };
  const rpc = fakeRpc({
    ...baseHandlers,
    ...(s.genesis ? { getGenesisHash: () => s.genesis } : {}),
    getAccountInfo: () => ({ context: { slot: 1 }, value: s.feeAccountValue ?? feeAccount.value }),
    getMultipleAccounts: (p) => ({ context: { slot: 1 }, value: (p[0] as string[]).map(before) }),
    simulateTransaction: (p) => {
      if (s.simFails) return simErr({ InstructionError: [3, { Custom: 6001 }] }, ['Program log: Error: SlippageToleranceExceeded']);
      const cfg = p[1] as { accounts?: { addresses: string[] } };
      return simOk(150_000, cfg.accounts ? cfg.accounts.addresses.map(after) : null);
    },
  });
  return { rpc, fetchImpl, urls };
}

async function swap(scan: ScanResult, w = world(), config = testConfig(), account = ADDR.swapInput, platform: 'android' | 'ios' | 'web' = 'android') {
  return prepareSwap({ rpc: w.rpc.transport, scan, request: { account }, config, platform, fetchImpl: w.fetchImpl, now: NOW });
}

async function expectCode(p: Promise<unknown>, code: string) {
  try {
    await p;
  } catch (e) {
    expect(isCleanupError(e) ? e.code : e).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('prepareSwap on a recorded Jupiter response', () => {
  it('builds, checks and simulates a swap with the integrator fee from config', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const w = world();
    // Signable bytes exist only outside simulation-only mode (devnet here).
    const offer = await swap(scan, w, testConfig({ swap: { simulationOnly: false } }));
    expect(offer.simulationOnly).toBe(false);

    const url = new URL(w.urls[0] as string);
    expect(url.origin + url.pathname).toBe('https://api.jup.ag/swap/v2/build');
    expect(Object.fromEntries(url.searchParams)).toMatchObject({
      inputMint: ADDR.swapMint,
      outputMint: WSOL_MINT,
      amount: IN_AMOUNT.toString(),
      taker: ADDR.owner,
      slippageBps: '100',
      platformFeeBps: '50',
      feeAccount: ADDR.feeAccount,
      transactionVersion: '0',
    });

    expect(offer.fee).toEqual({ lamports: MEASURED_FEE, bps: 50, recipientAccount: ADDR.feeAccount, recipientWallet: ADDR.feeWallet });
    expect(offer.quote).toMatchObject({ outLamports: 2_100_000n, minOutLamports: 2_079_000n, slippageBps: 100, route: ['Whirlpool'] });
    expect(offer.simulated.inputDeltaRaw).toBe(-IN_AMOUNT);
    expect(offer.computeUnitLimit).toBe(180_000);
    expect(offer.networkFeeLamports).toBe(5000n + 9000n);

    const d = decodeTx(offer.base64 as string, TABLES);
    expect(d.version).toBe(0);
    expect(d.feePayer).toBe(ADDR.owner);
    expect(d.signers).toBe(1);
    expect(d.instructions.map((i) => i.program)).toEqual([
      COMPUTE_BUDGET_PROGRAM,
      COMPUTE_BUDGET_PROGRAM,
      ASSOCIATED_TOKEN_PROGRAM,
      JUPITER_AGGREGATOR_PROGRAM,
      TOKEN_PROGRAM,
    ]);
    expect(d.instructions[0]?.data[0]).toBe(2);
    expect(new DataView(new Uint8Array(d.instructions[0]?.data ?? []).buffer).getUint32(1, true)).toBe(180_000);
    expect(u64At(d.instructions[1]?.data.slice(1) ?? [], 0)).toBe(50_000n);
    const jup = d.instructions[3];
    expect(jup?.accounts).toEqual(build().swapInstruction.accounts.map((a) => a.pubkey));
    // the pools were loaded from the lookup table that was read from the chain
    expect(decodeTx(offer.base64 as string).instructions[3]?.accounts.filter((a) => a === '?').length).toBe(4);

    const sims = w.rpc.calls.filter((c) => c.method === 'simulateTransaction');
    expect(sims.at(-1)?.params[0]).toBe(offer.base64);
  });

  it('without a fee wallet there is no platform fee in the request and no fee in the offer', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const jupiter = build();
    jupiter.swapInstruction.accounts = jupiter.swapInstruction.accounts.filter((a) => a.pubkey !== ADDR.feeAccount);
    const w = world({ jupiter });
    const offer = await swap(scan, w, createConfig({ feeWallet: null, swapFeeTokenAccount: null, swap: { simulationOnly: false } }));
    expect(new URL(w.urls[0] as string).searchParams.has('platformFeeBps')).toBe(false);
    expect(offer.fee).toBeNull();
  });

  it('on mainnet runs as simulation only: numbers yes, signable bytes never', async () => {
    const scan = { ...(await scanFixture('wallet-mixed.json')), cluster: 'mainnet-beta' as const };
    const w = world({ genesis: GENESIS_HASH['mainnet-beta'] });
    const offer = await swap(scan, w, testConfig({ cluster: 'mainnet-beta' }));
    expect(offer.simulationOnly).toBe(true);
    expect(offer.base64).toBeNull();
    expect(offer.fee?.lamports).toBe(MEASURED_FEE);
    expect(w.rpc.calls.filter((c) => c.method === 'simulateTransaction')).toHaveLength(2);
    // without simulation-only, mainnet stays blocked
    await expectCode(
      swap(scan, world({ genesis: GENESIS_HASH['mainnet-beta'] }), testConfig({ cluster: 'mainnet-beta', swap: { simulationOnly: false } })),
      'MAINNET_BLOCKED',
    );
  });

  it('fails closed while the fee wallet is the placeholder', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const w = world();
    await expectCode(swap(scan, w, createConfig()), 'FEE_WALLET_NOT_SET');
    expect(w.urls).toHaveLength(0);
    // a real fee wallet is not enough: the swap fee account must be set too
    await expectCode(swap(scan, w, createConfig({ feeWallet: ADDR.feeWallet })), 'FEE_WALLET_NOT_SET');
    expect(w.urls).toHaveLength(0);
  });

  it('is off on iOS and refuses NFTs, frozen, empty and wrapped SOL accounts', async () => {
    const mixed = await scanFixture('wallet-mixed.json');
    await expectCode(swap(mixed, world(), testConfig(), ADDR.swapInput, 'ios'), 'FEATURE_DISABLED');
    await expectCode(swap(mixed, world(), testConfig(), ADDR.wsolAccount), 'NOT_SWAPPABLE');
    const nft = await scanFixture('wallet-nft.json');
    await expectCode(swap(nft, world(), testConfig(), nft.accounts[0]?.address as string), 'PROTECTED');
    const frozen = await scanFixture('wallet-frozen.json');
    const f = frozen.accounts.find((a) => a.category === 'frozen' && a.amountRaw > 0n);
    await expectCode(swap(frozen, world(), testConfig(), f?.address as string), 'NOT_SWAPPABLE');
  });

  it('never offers a swap that fails simulation', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    await expectCode(swap(scan, world({ simFails: true })), 'SIMULATION_FAILED');
  });
});

describe('hostile or broken Jupiter responses are refused', () => {
  const cases: [string, (j: Json) => void, string][] = [
    ['a token approval', (j) => j.setupInstructions.push(ix(TOKEN_PROGRAM, [[ADDR.swapInput, false, true], [ADDR.stranger, false, false], [ADDR.owner, true, false]], [4, 1, 0, 0, 0, 0, 0, 0, 0])), 'UNSAFE_TRANSACTION'],
    ['an unknown program', (j) => j.otherInstructions.push(ix(ADDR.stranger, [[ADDR.owner, false, true]], [1])), 'UNSAFE_TRANSACTION'],
    ['a SOL transfer', (j) => j.otherInstructions.push(ix(SYSTEM_PROGRAM, [[ADDR.owner, true, true], [ADDR.stranger, false, true]], [2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0])), 'UNSAFE_TRANSACTION'],
    ['a second signer', (j) => j.swapInstruction.accounts.push({ pubkey: ADDR.stranger, isSigner: true, isWritable: false }), 'UNSAFE_TRANSACTION'],
    ['a write to another token account of the user', (j) => j.swapInstruction.accounts.push({ pubkey: ADDR.usdcAccount, isSigner: false, isWritable: true }), 'UNSAFE_TRANSACTION'],
    ['a close that pays someone else', (j) => { (j.cleanupInstruction.accounts[1] as Ix['accounts'][number]).pubkey = ADDR.stranger; }, 'UNSAFE_TRANSACTION'],
    ['a close of the input account', (j) => { (j.cleanupInstruction.accounts[0] as Ix['accounts'][number]).pubkey = ADDR.swapInput; }, 'UNSAFE_TRANSACTION'],
    ['an account created for someone else', (j) => { (j.setupInstructions[0] as Ix).accounts[2] = { pubkey: ADDR.stranger, isSigner: false, isWritable: false }; }, 'UNSAFE_TRANSACTION'],
    ['a compute price above the cap', (j) => { j.computeBudgetInstructions = [ix('ComputeBudget111111111111111111111111111111', [], [3, 0, 0, 0, 1, 0, 0, 0, 0])]; }, 'UNSAFE_TRANSACTION'],
    ['a swap without the fee account', (j) => { j.swapInstruction.accounts = j.swapInstruction.accounts.filter((a) => a.pubkey !== ADDR.feeAccount); }, 'UNSAFE_TRANSACTION'],
    ['a swap that does not spend the selected account', (j) => { j.swapInstruction.accounts = j.swapInstruction.accounts.filter((a) => a.pubkey !== ADDR.swapInput); }, 'UNSAFE_TRANSACTION'],
    ['an unrequested tip', (j) => { j.tipInstruction = ix(SYSTEM_PROGRAM, [], [2]); }, 'BAD_RESPONSE'],
    ['another input mint', (j) => { j.inputMint = ADDR.stranger; }, 'BAD_RESPONSE'],
    ['another amount', (j) => { j.inAmount = '1'; }, 'BAD_RESPONSE'],
    ['an output that is not SOL', (j) => { j.outputMint = ADDR.stranger; }, 'BAD_RESPONSE'],
    ['a slippage above config', (j) => { j.slippageBps = 5000; }, 'BAD_RESPONSE'],
    ['a minimum above the quote', (j) => { j.otherAmountThreshold = '9999999'; }, 'BAD_RESPONSE'],
    ['broken instruction data', (j) => { j.swapInstruction.data = '<not base64>'; }, 'BAD_RESPONSE'],
    ['a high price impact', (j) => { j.priceImpactPct = '0.4'; }, 'NOT_SWAPPABLE'],
  ];

  for (const [name, mutate, code] of cases) {
    it(`refuses ${name}`, async () => {
      const scan = await scanFixture('wallet-mixed.json');
      const jupiter = build();
      mutate(jupiter);
      const w = world({ jupiter });
      await expectCode(swap(scan, w), code);
      expect(w.rpc.calls.some((c) => c.method === 'simulateTransaction')).toBe(false);
    });
  }

  it('refuses a lookup table that differs from the chain', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const jupiter = build();
    jupiter.addressesByLookupTableAddress = { [ADDR.lookupTable]: [ADDR.stranger] };
    await expectCode(swap(scan, world({ jupiter })), 'UNSAFE_TRANSACTION');
  });

  it('refuses a lookup table that is being deactivated', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const data = Buffer.from(lookupTable.account.data[0], 'base64');
    data.writeBigUInt64LE(5n, 4);
    await expectCode(swap(scan, world({ table: { ...lookupTable.account, data: [data.toString('base64'), 'base64'] } })), 'UNSAFE_TRANSACTION');
  });

  it('refuses a fee account that does not belong to the fee wallet', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const value = structuredClone(feeAccount.value) as { data: { parsed: { info: { owner: string } } } };
    value.data.parsed.info.owner = ADDR.stranger;
    await expectCode(swap(scan, world({ feeAccountValue: value })), 'FEE_ACCOUNT_INVALID');
  });

  it('refuses when the simulated fee is above the configured rate', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    await expectCode(swap(scan, world({ feeAfter: FEE_BEFORE + 50_000n })), 'UNSAFE_TRANSACTION');
  });

  it('refuses when the simulation spends a different amount than selected', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    await expectCode(swap(scan, world({ inputAfter: 5n })), 'UNSAFE_TRANSACTION');
  });
});
