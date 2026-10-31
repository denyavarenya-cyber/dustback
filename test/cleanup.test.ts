import { describe, expect, it } from 'vitest';
import { planCleanup, prepareCleanup } from '../src/cleanup';
import { createConfig } from '../src/config';
import { SYSTEM_PROGRAM, TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from '../src/constants';
import { isCleanupError } from '../src/errors';
import type { ScanResult } from '../src/scan';
import {
  ADDR,
  BLOCKHASH,
  baseHandlers,
  decodeTx,
  fakeRpc,
  NOW,
  scanFixture,
  simErr,
  simOk,
  testConfig,
  u64At,
} from './helpers';

const lifetime = { blockhash: BLOCKHASH, lastValidBlockHeight: 1150n };
const closable = (scan: ScanResult) => scan.accounts.filter((a) => a.closable).map((a) => a.address);

function plan(scan: ScanResult, close: string[], config = testConfig(), extra: object = {}) {
  return planCleanup({ scan, selection: { close, ...extra }, config, platform: 'android', lifetime, now: NOW });
}

async function expectCode(fn: () => unknown, code: string) {
  try {
    await fn();
  } catch (e) {
    expect(isCleanupError(e) ? e.code : e).toBe(code);
    return;
  }
  throw new Error(`expected ${code}`);
}

describe('selection rules', () => {
  it('nothing selected gives no transactions, even with closable accounts', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    expect(plan(scan, [])).toEqual([]);
  });

  it('an empty wallet gives no transactions', async () => {
    const scan = await scanFixture('wallet-empty.json');
    expect(plan(scan, [])).toEqual([]);
  });

  it('an NFT is never closed', async () => {
    const scan = await scanFixture('wallet-nft.json');
    const nft = scan.accounts[0]?.address as string;
    await expectCode(() => plan(scan, [nft]), 'PROTECTED');
  });

  it('a frozen account is refused', async () => {
    const scan = await scanFixture('wallet-frozen.json');
    const frozen = scan.accounts.find((a) => a.category === 'frozen')?.address as string;
    await expectCode(() => plan(scan, [frozen]), 'NOT_CLOSABLE');
  });

  it('a dust balance is not closable', async () => {
    const scan = await scanFixture('wallet-dust50.json');
    await expectCode(() => plan(scan, [scan.accounts[0]?.address as string]), 'NOT_CLOSABLE');
  });

  it('blocked Token-2022 accounts are refused', async () => {
    const scan = await scanFixture('wallet-token2022.json');
    for (const a of scan.accounts.filter((x) => x.category === 'blocked')) {
      await expectCode(() => plan(scan, [a.address]), 'NOT_CLOSABLE');
    }
  });

  it('an address outside the scan, a duplicate, or garbage is refused', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const first = scan.accounts[0]?.address as string;
    await expectCode(() => plan(scan, [ADDR.stranger]), 'NOT_IN_SCAN');
    await expectCode(() => plan(scan, [first, first]), 'NOT_CLOSABLE');
    await expectCode(() => plan(scan, ['<script>']), 'INVALID_ADDRESS');
  });

  it('only the selected accounts are closed', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const picked = closable(scan).slice(3, 6);
    const [tx] = plan(scan, picked);
    expect(tx?.accounts.map((a) => a.address)).toEqual(picked);
    const closes = decodeTx(tx?.base64 as string).instructions.filter((i) => i.data[0] === 9);
    expect(closes.map((i) => i.accounts[0])).toEqual(picked);
  });
});

describe('transactions and the fee instruction', () => {
  it('closes send rent to the owner, and the fee is the last, separate instruction', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const picked = closable(scan).slice(0, 5);
    const [tx] = plan(scan, picked);
    const d = decodeTx(tx?.base64 as string);
    expect(d.feePayer).toBe(ADDR.owner);
    expect(d.signers).toBe(1);
    for (const ix of d.instructions.filter((i) => i.data[0] === 9)) {
      expect(ix.program).toBe(TOKEN_PROGRAM);
      expect(ix.accounts[1]).toBe(ADDR.owner);
      expect(ix.accounts[2]).toBe(ADDR.owner);
    }
    const last = d.instructions.at(-1);
    expect(last?.program).toBe(SYSTEM_PROGRAM);
    expect(last?.accounts).toEqual([ADDR.owner, ADDR.feeWallet]);
    const rent = 5n * 2039280n;
    const fee = (rent * 300n) / 10000n;
    expect(u64At(last?.data ?? [], 4)).toBe(fee);
    expect(tx?.fee).toEqual({ lamports: fee, bps: 300, recipient: ADDR.feeWallet });
    expect(tx?.rentLamports).toBe(rent);
    expect(tx?.netLamports).toBe(rent - fee - 5000n);
  });

  it('the fee rate comes from config', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const [tx] = plan(scan, closable(scan).slice(0, 2), testConfig({ cleanupFeeBps: 250 }));
    expect(tx?.fee?.lamports).toBe((2n * 2039280n * 250n) / 10000n);
  });

  it('no fee wallet means no fee instruction and a zero fee, never a transfer to the user', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const config = createConfig({ feeWallet: null, swapFeeTokenAccount: null });
    const [tx] = plan(scan, closable(scan).slice(0, 3), config);
    expect(tx?.fee).toBeNull();
    const d = decodeTx(tx?.base64 as string);
    expect(d.instructions.some((i) => i.program === SYSTEM_PROGRAM)).toBe(false);
    expect(tx?.netLamports).toBe(3n * 2039280n - 5000n);
  });

  it('withheld Token-2022 fees are harvested to the mint before the close', async () => {
    const scan = await scanFixture('wallet-token2022.json');
    const withheld = scan.accounts[0];
    const [tx] = plan(scan, [withheld?.address as string]);
    expect(tx?.accounts[0]?.action).toBe('harvestAndClose');
    const ixs = decodeTx(tx?.base64 as string).instructions.filter((i) => i.program === TOKEN_2022_PROGRAM);
    expect(ixs[0]?.data).toEqual([26, 4]);
    expect(ixs[0]?.accounts).toEqual([withheld?.mint, withheld?.address]);
    expect(ixs[1]?.data).toEqual([9]);
  });

  it('wrapped SOL is unwrapped, and the fee is on its rent part only', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const [tx] = plan(scan, [ADDR.wsolAccount]);
    expect(tx?.accounts[0]?.action).toBe('unwrap');
    expect(tx?.returnLamports).toBe(52039280n);
    expect(tx?.fee?.lamports).toBe((2039280n * 300n) / 10000n);
  });

  it('a batch over the size limit is split; every transaction fits and every account appears once', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const all = closable(scan);
    const txs = plan(scan, all);
    expect(txs.length).toBeGreaterThan(2);
    const seen = txs.flatMap((t) => t.accounts.map((a) => a.address));
    expect(seen).toEqual(all);
    for (const t of txs) {
      expect(t.bytes).toBeLessThanOrEqual(1232);
      expect(decodeTx(t.base64).bytes).toBe(t.bytes);
      expect(t.fee?.lamports).toBe((t.rentLamports * 300n) / 10000n);
    }
    const totalRent = txs.reduce((s, t) => s + t.rentLamports, 0n);
    expect(totalRent).toBe(scan.totals.reclaimableRentLamports);
  });

  it('a smaller byte cap in config gives more transactions', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const all = closable(scan);
    const normal = plan(scan, all).length;
    const tight = plan(scan, all, testConfig({ maxTransactionBytes: 600 }));
    expect(tight.length).toBeGreaterThan(normal);
    for (const t of tight) expect(t.bytes).toBeLessThanOrEqual(600);
  });
});

describe('guards', () => {
  it('iOS is always off, whatever the config says', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    await expectCode(
      () => planCleanup({ scan, selection: { close: [] }, config: testConfig(), platform: 'ios', lifetime, now: NOW }),
      'FEATURE_DISABLED',
    );
  });

  it('a platform switched off in config is refused', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const config = testConfig({ features: { web: { cleanup: false } } });
    await expectCode(
      () => planCleanup({ scan, selection: { close: [] }, config, platform: 'web', lifetime, now: NOW }),
      'FEATURE_DISABLED',
    );
  });

  it('mainnet is blocked until allowMainnet is set', async () => {
    const config = testConfig({ cluster: 'mainnet-beta' });
    const scan = { ...(await scanFixture('wallet-many-empty.json')), cluster: 'mainnet-beta' as const };
    await expectCode(() => plan(scan, [], config), 'MAINNET_BLOCKED');
  });

  it('a stale scan or a scan from another cluster is refused', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const later = new Date(NOW.getTime() + 601_000);
    await expectCode(
      () => planCleanup({ scan, selection: { close: [] }, config: testConfig(), platform: 'web', lifetime, now: later }),
      'STALE_SCAN',
    );
    await expectCode(() => plan({ ...scan, cluster: 'mainnet-beta' }, []), 'CLUSTER_MISMATCH');
  });
});

describe('burning', () => {
  const burnConfig = (o = {}) => testConfig({ burn: { enabled: true, maxValueUsd: 0.1, allowUnpriced: false, ...o } });

  it('is refused while switched off', async () => {
    const scan = await scanFixture('wallet-dust50.json');
    const a = scan.accounts[0];
    await expectCode(
      () => plan(scan, [], testConfig(), { burn: [{ address: a?.address, amountRaw: String(a?.amountRaw) }] }),
      'BURN_REFUSED',
    );
  });

  it('never burns an NFT, even when burning is on and the NFT is priced', async () => {
    const scan = await scanFixture('wallet-nft.json');
    for (const nft of scan.accounts.filter((a) => a.category === 'nft')) {
      await expectCode(
        () => plan(scan, [], burnConfig({ allowUnpriced: true, maxValueUsd: 1000 }), {
          burn: [{ address: nft.address, amountRaw: '1' }],
        }),
        'PROTECTED',
      );
    }
  });

  it('refuses a balance worth more than the configured threshold', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    const usdc = scan.accounts.find((a) => a.address === ADDR.usdcAccount);
    await expectCode(
      () => plan(scan, [], burnConfig({ maxValueUsd: 1000 }), { burn: [{ address: ADDR.usdcAccount, amountRaw: String(usdc?.amountRaw) }] }),
      'BURN_REFUSED',
    );
    const input = scan.accounts.find((a) => a.address === ADDR.swapInput);
    expect(input?.valueUsd as number).toBeGreaterThan(0.01);
    await expectCode(
      () => plan(scan, [], burnConfig({ maxValueUsd: 0.01 }), { burn: [{ address: ADDR.swapInput, amountRaw: String(input?.amountRaw) }] }),
      'BURN_REFUSED',
    );
  });

  it('refuses unpriced tokens unless config allows them, and any amount but the full balance', async () => {
    const scan = await scanFixture('wallet-dust50.json');
    const a = scan.accounts[0];
    const unpriced = { ...scan, accounts: scan.accounts.map((x) => ({ ...x, category: 'noMarket' as const, valueUsd: null, priceUsd: null })) };
    await expectCode(
      () => plan(unpriced, [], burnConfig(), { burn: [{ address: a?.address, amountRaw: String(a?.amountRaw) }] }),
      'BURN_REFUSED',
    );
    await expectCode(
      () => plan(scan, [], burnConfig(), { burn: [{ address: a?.address, amountRaw: '1' }] }),
      'BURN_REFUSED',
    );
  });

  it('burns exactly the selected token, then closes it', async () => {
    const scan = await scanFixture('wallet-dust50.json');
    const a = scan.accounts[2];
    const [tx] = plan(scan, [], burnConfig(), { burn: [{ address: a?.address, amountRaw: String(a?.amountRaw) }] });
    expect(tx?.accounts).toHaveLength(1);
    const ixs = decodeTx(tx?.base64 as string).instructions.filter((i) => i.program === TOKEN_PROGRAM);
    expect(ixs[0]?.data[0]).toBe(15);
    expect(ixs[0]?.accounts).toEqual([a?.address, a?.mint, ADDR.owner]);
    expect(u64At(ixs[0]?.data.slice(1) ?? [], 0)).toBe(a?.amountRaw);
    expect(ixs[1]?.data).toEqual([9]);
  });
});

describe('prepareCleanup simulates the exact bytes before offering', () => {
  it('offers simulated transactions with a compute limit from the measured units', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const picked = closable(scan).slice(0, 4);
    const rpc = fakeRpc({
      ...baseHandlers,
      simulateTransaction: (p) => {
        const cfg = p[1] as { accounts?: { addresses: string[] } };
        return simOk(10_000, cfg.accounts ? cfg.accounts.addresses.map(() => null) : null);
      },
    });
    const offer = await prepareCleanup({ rpc: rpc.transport, scan, selection: { close: picked }, config: testConfig(), platform: 'android', now: NOW });
    expect(offer.rejected).toEqual([]);
    expect(offer.transactions).toHaveLength(1);
    expect(offer.transactions[0]?.computeUnitLimit).toBe(12_000);
    const sims = rpc.calls.filter((c) => c.method === 'simulateTransaction');
    expect(sims).toHaveLength(2);
    // the offered bytes are exactly the bytes simulated last
    expect(sims[1]?.params[0]).toBe(offer.transactions[0]?.base64);
    expect(sims[1]?.params[1]).toMatchObject({ sigVerify: false, replaceRecentBlockhash: false });
    expect(offer.totals.feeLamports).toBe((4n * 2039280n * 300n) / 10000n);
  });

  it('never offers a transaction that fails simulation', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const all = closable(scan);
    let call = 0;
    const rpc = fakeRpc({
      ...baseHandlers,
      simulateTransaction: (p) => {
        call++;
        const cfg = p[1] as { accounts?: { addresses: string[] } };
        if (call === 1) return simErr({ InstructionError: [3, { Custom: 17 }] }, ['Program log: Error: Account is frozen']);
        return simOk(9_000, cfg.accounts ? cfg.accounts.addresses.map(() => null) : null);
      },
    });
    const offer = await prepareCleanup({ rpc: rpc.transport, scan, selection: { close: all }, config: testConfig(), platform: 'web', now: NOW });
    expect(offer.rejected).toHaveLength(1);
    expect(offer.rejected[0]?.reason).toContain('Account is frozen');
    expect(offer.transactions.length).toBeGreaterThan(0);
    const offered = offer.transactions.flatMap((t) => t.accounts.map((a) => a.address));
    for (const r of offer.rejected[0]?.accounts ?? []) expect(offered).not.toContain(r);
    expect(offer.totals.accounts).toBe(all.length - (offer.rejected[0]?.accounts.length ?? 0));
  });

  it('refuses a transaction when an account stays open in the simulation', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const rpc = fakeRpc({
      ...baseHandlers,
      simulateTransaction: (p) => {
        const cfg = p[1] as { accounts?: { addresses: string[] } };
        return simOk(5_000, cfg.accounts ? cfg.accounts.addresses.map(() => ({ data: ['', 'base64'], executable: false, lamports: 2039280, owner: TOKEN_PROGRAM, rentEpoch: 0, space: 165 })) : null);
      },
    });
    const offer = await prepareCleanup({ rpc: rpc.transport, scan, selection: { close: closable(scan).slice(0, 2) }, config: testConfig(), platform: 'web', now: NOW });
    expect(offer.transactions).toEqual([]);
    expect(offer.rejected).toHaveLength(1);
  });

  it('explains an unfunded fee wallet', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const rpc = fakeRpc({ ...baseHandlers, simulateTransaction: () => simErr({ InsufficientFundsForRent: { account_index: 2 } }) });
    const offer = await prepareCleanup({ rpc: rpc.transport, scan, selection: { close: closable(scan).slice(0, 1) }, config: testConfig(), platform: 'web', now: NOW });
    expect(offer.rejected[0]?.reason).toMatch(/fee wallet/);
  });

  it('refuses an RPC endpoint that serves another cluster', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const rpc = fakeRpc({ ...baseHandlers, getGenesisHash: () => '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d' });
    await expectCode(
      () => prepareCleanup({ rpc: rpc.transport, scan, selection: { close: closable(scan).slice(0, 1) }, config: testConfig(), platform: 'web', now: NOW }),
      'CLUSTER_MISMATCH',
    );
  });
});
