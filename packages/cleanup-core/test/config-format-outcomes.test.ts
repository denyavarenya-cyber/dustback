import { describe, expect, it } from 'vitest';
import {
  assertCanBuild,
  assertCanSend,
  cleanupFeeActive,
  createConfig,
  DEFAULT_CONFIG,
  FEE_WALLET_PLACEHOLDER,
  isFeatureEnabled,
  swapFeeActive,
} from '../src/config';
import { isCleanupError } from '../src/errors';
import { formatSol, formatTokenAmount, shorten } from '../src/format';
import { explorerAddressUrl, explorerTxUrl, isSignature, waitForOutcomes } from '../src/outcomes';
import { createJupiterPriceSource } from '../src/prices';
import { ADDR, fakeRpc, walletEntries } from './helpers';

const SIG = '5VERv8NMvzbJMEkV8xnrLkEaWRtSz9CosKDYjCJjBRnbJLgp8uirBgmQpjKhoR4tjF3ZpRzrFmBV6UjKdiSZkQUW';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return isCleanupError(e) ? e.code : 'other';
  }
  return undefined;
}

describe('config', () => {
  it('defaults to devnet, mainnet blocked, 3 percent cleanup, swaps simulation only', () => {
    expect(DEFAULT_CONFIG.cluster).toBe('devnet');
    expect(DEFAULT_CONFIG.allowMainnet).toBe(false);
    expect(DEFAULT_CONFIG.cleanupFeeBps).toBe(300);
    expect(DEFAULT_CONFIG.swapFeeBps).toBe(50);
    expect(DEFAULT_CONFIG.swap.simulationOnly).toBe(true);
    expect(DEFAULT_CONFIG.burn.enabled).toBe(false);
    expect(cleanupFeeActive(DEFAULT_CONFIG)).toBe(false);
    expect(swapFeeActive(DEFAULT_CONFIG)).toBe(false);
  });

  it('the fee wallet placeholder fails closed for cleanup and swaps', () => {
    const config = createConfig();
    expect(config.feeWallet).toBe(FEE_WALLET_PLACEHOLDER);
    expect(code(() => assertCanBuild(config, 'web', 'cleanup'))).toBe('FEE_WALLET_NOT_SET');
    expect(code(() => assertCanBuild(config, 'android', 'swap'))).toBe('FEE_WALLET_NOT_SET');
    const real = createConfig({ feeWallet: ADDR.feeWallet, swapFeeTokenAccount: ADDR.feeAccount });
    expect(code(() => assertCanBuild(real, 'web', 'cleanup'))).toBeUndefined();
  });

  it('iOS can never be switched on', () => {
    const config = createConfig({ features: { android: { cleanup: true, swap: true }, web: { cleanup: true, swap: true } } });
    expect(isFeatureEnabled(config, 'ios', 'cleanup')).toBe(false);
    expect(isFeatureEnabled(config, 'ios', 'swap')).toBe(false);
    const forced = { ...config, features: { ...config.features, ios: { cleanup: true, swap: true } } };
    expect(isFeatureEnabled(forced as never, 'ios', 'swap')).toBe(false);
  });

  it('mainnet needs allowMainnet, except swaps in simulation-only mode, which never send', () => {
    const fees = { feeWallet: ADDR.feeWallet, swapFeeTokenAccount: ADDR.feeAccount };
    const mainnet = createConfig({ ...fees, cluster: 'mainnet-beta' });
    expect(code(() => assertCanBuild(mainnet, 'web', 'cleanup'))).toBe('MAINNET_BLOCKED');
    expect(code(() => assertCanBuild(mainnet, 'web', 'swap'))).toBeUndefined();
    expect(code(() => assertCanSend(mainnet))).toBe('MAINNET_BLOCKED');
    const noSim = createConfig({ ...fees, cluster: 'mainnet-beta', swap: { simulationOnly: false } });
    expect(code(() => assertCanBuild(noSim, 'web', 'swap'))).toBe('MAINNET_BLOCKED');
    const allowed = createConfig({ ...fees, cluster: 'mainnet-beta', allowMainnet: true });
    expect(code(() => assertCanBuild(allowed, 'web', 'cleanup'))).toBeUndefined();
  });

  it('refuses fees above the hard caps and broken values', () => {
    expect(code(() => createConfig({ cleanupFeeBps: 2001 }))).toBe('INVALID_CONFIG');
    expect(code(() => createConfig({ swapFeeBps: 201 }))).toBe('INVALID_CONFIG');
    expect(code(() => createConfig({ cleanupFeeBps: 10.5 }))).toBe('INVALID_CONFIG');
    expect(code(() => createConfig({ feeWallet: 'not an address' }))).toBe('INVALID_CONFIG');
    expect(code(() => createConfig({ feeWallet: ADDR.feeWallet, swapFeeTokenAccount: null }))).toBe('INVALID_CONFIG');
    expect(code(() => createConfig({ maxTransactionBytes: 5000 }))).toBe('INVALID_CONFIG');
    expect(code(() => createConfig({ jupiter: { swapBaseUrl: 'http://api.jup.ag/swap/v2' } }))).toBe('INVALID_CONFIG');
  });
});

describe('formatting is exact', () => {
  it('formats lamports without floating point', () => {
    expect(formatSol(2039280n)).toBe('0.00203928');
    expect(formatSol(1_000_000_000n)).toBe('1.0000');
    expect(formatSol(123_456_789_012_345_678n)).toBe('123456789.012345678');
    expect(formatSol(-5000n)).toBe('-0.000005');
    expect(formatSol(0n, 0)).toBe('0');
  });

  it('formats token amounts and shortens addresses', () => {
    expect(formatTokenAmount(123456789n, 5)).toBe('1234.56789');
    expect(formatTokenAmount(1000n, 6)).toBe('0.001');
    expect(formatTokenAmount(7n, 0)).toBe('7');
    expect(shorten(ADDR.owner)).toMatch(/^.{4}….{4}$/);
  });
});

describe('links and outcomes', () => {
  it('builds explorer links only for real signatures and addresses', () => {
    expect(isSignature(SIG)).toBe(true);
    expect(explorerTxUrl(SIG, 'devnet')).toBe(`https://explorer.solana.com/tx/${SIG}?cluster=devnet`);
    expect(explorerTxUrl(SIG, 'mainnet-beta')).toBe(`https://explorer.solana.com/tx/${SIG}`);
    expect(explorerAddressUrl(ADDR.owner, 'devnet')).toContain(ADDR.owner);
    expect(isSignature('javascript:alert(1)')).toBe(false);
    expect(code(() => explorerTxUrl('"><img src=x>', 'devnet'))).toBe('BAD_RESPONSE');
    expect(code(() => explorerAddressUrl('../../etc', 'devnet'))).toBe('INVALID_ADDRESS');
  });

  it('reports confirmed, failed and timed out signatures separately', async () => {
    let round = 0;
    const rpc = fakeRpc({
      getSignatureStatuses: () => {
        round++;
        return {
          context: { slot: 1 },
          value: [
            { err: null, confirmationStatus: round > 1 ? 'confirmed' : 'processed' },
            { err: { InstructionError: [0, 'Custom'] }, confirmationStatus: 'confirmed' },
            null,
          ],
        };
      },
    });
    let t = 0;
    const outcomes = await waitForOutcomes({
      rpc: rpc.transport,
      signatures: ['a', 'b', 'c'],
      timeoutMs: 5000,
      pollMs: 1000,
      sleep: async (ms) => {
        t += ms;
      },
      now: () => t,
    });
    expect(outcomes).toEqual(['confirmed', 'failed', 'timeout']);
  });
});

describe('Jupiter prices', () => {
  it('chunks by 50, keeps only finite prices, and leaves failures unpriced', async () => {
    const dustMints = Object.keys(walletEntries('wallet-dust50.json').prices);
    const mints = [ADDR.swapMint, ...ADDR.pools, ...dustMints];
    const late = dustMints.at(-1) as string;
    const seen: string[] = [];
    const fetchImpl = (async (url: string) => {
      seen.push(url);
      if (seen.length === 2) return new Response('{}', { status: 500 });
      return new Response(JSON.stringify({ [ADDR.swapMint]: { usdPrice: 0.5 }, [ADDR.pools[1] as string]: { usdPrice: 'NaN' } }));
    }) as unknown as typeof fetch;
    const source = createJupiterPriceSource({ url: 'https://api.jup.ag/price/v3', fetchImpl, sleep: async () => {} });
    const prices = await source([...mints, 'not-a-mint']);
    expect(seen).toHaveLength(2);
    expect(prices.get(ADDR.swapMint)).toBe(0.5);
    expect(prices.has(ADDR.pools[1] as string)).toBe(false);
    expect(prices.has(late)).toBe(false);
    expect(seen.every((u) => u.startsWith('https://api.jup.ag/price/v3?ids='))).toBe(true);
    expect(seen.some((u) => u.includes('not-a-mint'))).toBe(false);
  });
});
