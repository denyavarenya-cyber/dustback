import { describe, expect, it } from 'vitest';
import { classifyEntries } from '../src/scan';
import { ADDR, NOW, scanFixture, testConfig, walletEntries } from './helpers';

const byLabel = async (name: string) => {
  const scan = await scanFixture(name);
  return { scan, get: (addr: string) => scan.accounts.find((a) => a.address === addr) };
};

describe('scan classification on recorded wallets', () => {
  it('an empty wallet has nothing to clean', async () => {
    const scan = await scanFixture('wallet-empty.json');
    expect(scan.accounts).toHaveLength(0);
    expect(scan.skipped).toBe(0);
    expect(scan.totals).toEqual({ closableCount: 0, reclaimableRentLamports: 0n, returnLamports: 0n });
  });

  it('fifty dust balances are dust, not closable, and nothing is selected for them', async () => {
    const scan = await scanFixture('wallet-dust50.json');
    expect(scan.byCategory.dust).toBe(50);
    expect(scan.totals.closableCount).toBe(0);
    for (const a of scan.accounts) {
      expect(a.category).toBe('dust');
      expect(a.closable).toBe(false);
      expect(a.valueUsd).not.toBeNull();
      expect(a.valueUsd as number).toBeLessThan(5);
    }
  });

  it('frozen accounts are never closable, with or without a balance', async () => {
    const { scan } = await byLabel('wallet-frozen.json');
    const frozen = scan.accounts.filter((a) => a.state === 'frozen');
    expect(frozen).toHaveLength(2);
    for (const a of frozen) {
      expect(a.category).toBe('frozen');
      expect(a.closable).toBe(false);
      expect(a.reasons.map((r) => r.code)).toContain('frozen');
    }
    expect(scan.totals.closableCount).toBe(1);
    expect(scan.totals.reclaimableRentLamports).toBe(2039280n);
  });

  it('Token-2022: withheld fees need a harvest; confidential, foreign close authority and unknown extensions block', async () => {
    const scan = await scanFixture('wallet-token2022.json');
    const cats = scan.accounts.map((a) => a.category);
    expect(cats).toEqual(['withheldFees', 'empty', 'blocked', 'blocked', 'blocked']);
    const [withheld, zero, confidential, foreignClose, unknown] = scan.accounts;
    expect(withheld?.needsHarvest).toBe(true);
    expect(withheld?.withheldAmount).toBe(15n);
    expect(withheld?.closable).toBe(true);
    expect(withheld?.rentLamports).toBe(2157600n);
    expect(zero?.needsHarvest).toBe(false);
    expect(confidential?.reasons[0]?.code).toBe('confidentialTransfer');
    expect(foreignClose?.reasons[0]).toEqual({ code: 'closeAuthorityElsewhere', detail: expect.any(String) });
    expect(unknown?.reasons[0]).toEqual({ code: 'unknownExtension', detail: 'someFutureExtension' });
    expect(scan.totals.closableCount).toBe(2);
  });

  it('NFTs are protected even when frozen or priced; an empty account of a sold NFT is closable', async () => {
    const scan = await scanFixture('wallet-nft.json');
    const [nft, pnft, sold] = scan.accounts;
    expect(nft?.category).toBe('nft');
    expect(nft?.protected).toBe(true);
    expect(nft?.closable).toBe(false);
    expect(pnft?.category).toBe('nft');
    expect(pnft?.protected).toBe(true);
    expect(pnft?.reasons.map((r) => r.code)).toEqual(['nftProtected', 'frozen']);
    expect(sold?.category).toBe('empty');
    expect(sold?.closable).toBe(true);
  });

  it('seventy empty accounts across both programs add up exactly', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    expect(scan.byCategory.empty).toBe(70);
    expect(scan.totals.reclaimableRentLamports).toBe(50n * 2039280n + 20n * 2074080n);
  });

  it('skips malformed and foreign entries, values wrapped SOL by its rent part only', async () => {
    const scan = await scanFixture('wallet-mixed.json');
    expect(scan.skipped).toBe(2);
    expect(scan.accounts.some((a) => a.owner !== ADDR.owner)).toBe(false);
    const wsol = scan.accounts.find((a) => a.address === ADDR.wsolAccount);
    expect(wsol?.category).toBe('wrappedSol');
    expect(wsol?.rentLamports).toBe(2039280n);
    expect(wsol?.returnLamports).toBe(52039280n);
    const usdc = scan.accounts.find((a) => a.address === ADDR.usdcAccount);
    expect(usdc?.category).toBe('valuable');
    const input = scan.accounts.find((a) => a.address === ADDR.swapInput);
    expect(input?.category).toBe('dust');
  });

  it('the dust threshold comes from config', async () => {
    const w = walletEntries('wallet-mixed.json');
    const config = testConfig({ dustThresholdUsd: 300 });
    const scan = await classifyEntries({
      owner: w.owner,
      cluster: 'devnet',
      entries: { token: w.token, token2022: w.token2022 },
      prices: async () => new Map(Object.entries(w.prices)),
      config,
      now: NOW,
    });
    expect(scan.accounts.find((a) => a.address === ADDR.usdcAccount)?.category).toBe('dust');
  });

  it('without prices nothing is called dust', async () => {
    const w = walletEntries('wallet-dust50.json');
    const scan = await classifyEntries({
      owner: w.owner,
      cluster: 'devnet',
      entries: { token: w.token, token2022: [] },
      config: testConfig(),
      now: NOW,
    });
    expect(scan.byCategory.noMarket).toBe(50);
    expect(scan.byCategory.dust).toBe(0);
  });
});
