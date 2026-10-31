import { isAddress } from '@solana/kit';
import { JUPITER_AGGREGATOR_PROGRAM } from './constants';
import { CleanupError } from './errors';

export type Cluster = 'devnet' | 'mainnet-beta';
export type Platform = 'ios' | 'android' | 'web';
export type Feature = 'cleanup' | 'swap';

/** Platforms whose switches live in config. iOS is not one of them: see isFeatureEnabled. */
export type SwitchablePlatform = Exclude<Platform, 'ios'>;

export interface CleanupConfig {
  cluster: Cluster;
  /**
   * Building transactions for mainnet stays impossible until the owner has
   * approved it in writing and this is set to true on purpose.
   */
  allowMainnet: boolean;
  features: Record<SwitchablePlatform, Record<Feature, boolean>>;
  /**
   * Public address that receives fees. FEE_WALLET_PLACEHOLDER (the default)
   * fails closed: nothing can be built until a real address is set. null means
   * the owner chose no fee at all.
   */
  feeWallet: string | null;
  /** Fee on reclaimed rent, in basis points (1000 = 10 percent). */
  cleanupFeeBps: number;
  /** Jupiter integrator fee on swap output, in basis points (50 = 0.5 percent). */
  swapFeeBps: number;
  /** Wrapped SOL token account owned by feeWallet; receives swap fees. */
  swapFeeTokenAccount: string | null;
  /** A non-empty balance priced under this many USD is classified as dust. */
  dustThresholdUsd: number;
  burn: {
    /** Burning is off unless the owner turns it on. */
    enabled: boolean;
    /** A token whose balance is worth more than this is never burned. */
    maxValueUsd: number;
    /** Allow burning tokens without a price (their value cannot be checked). */
    allowUnpriced: boolean;
  };
  /** Cap on the serialized transaction size, at most 1232. */
  maxTransactionBytes: number;
  /** A scan older than this cannot be turned into transactions. */
  maxScanAgeSeconds: number;
  /** Compute unit limit = units used in simulation times this margin. */
  computeUnitMargin: number;
  swap: {
    /**
     * Build and simulate swaps on mainnet without ever producing signable
     * bytes. Owner decision of 31 October: the wallet never opens for swaps.
     */
    simulationOnly: boolean;
    slippageBps: number;
    /** Ratio, 0.05 = 5 percent. Swaps with a higher price impact are refused. */
    maxPriceImpact: number;
    /** Passed to Jupiter to keep the route small enough for one transaction. */
    maxAccounts: number;
    /** Priority fee cap; a higher price from Jupiter is refused. */
    maxComputeUnitPriceMicroLamports: number;
  };
  jupiter: {
    swapBaseUrl: string;
    priceUrl: string;
    apiKey: string | null;
    /** Programs a Jupiter swap instruction may call. */
    programIds: string[];
  };
}

/** Hard caps that protect users from a typo in config. Raising them is a code change. */
export const MAX_CLEANUP_FEE_BPS = 2000;
export const MAX_SWAP_FEE_BPS = 200;

/** Stands in for the fee wallet until the owner gives its address. Fails closed. */
export const FEE_WALLET_PLACEHOLDER = 'FEE_WALLET_NOT_SET';

export const DEFAULT_CONFIG: CleanupConfig = {
  cluster: 'devnet',
  allowMainnet: false,
  features: {
    android: { cleanup: true, swap: true },
    web: { cleanup: true, swap: true },
  },
  feeWallet: FEE_WALLET_PLACEHOLDER,
  // Owner decisions of 31 October: cleanup 3 percent; swap 0.5 percent once
  // Jupiter confirms in writing that it takes no share on /build.
  cleanupFeeBps: 300,
  swapFeeBps: 50,
  swapFeeTokenAccount: FEE_WALLET_PLACEHOLDER,
  dustThresholdUsd: 5,
  burn: { enabled: false, maxValueUsd: 0.1, allowUnpriced: false },
  maxTransactionBytes: 1232,
  maxScanAgeSeconds: 600,
  computeUnitMargin: 1.2,
  swap: {
    simulationOnly: true,
    slippageBps: 100,
    maxPriceImpact: 0.05,
    maxAccounts: 40,
    maxComputeUnitPriceMicroLamports: 100_000,
  },
  jupiter: {
    swapBaseUrl: 'https://api.jup.ag/swap/v2',
    priceUrl: 'https://api.jup.ag/price/v3',
    apiKey: null,
    programIds: [JUPITER_AGGREGATOR_PROGRAM],
  },
};

export interface ConfigOverrides
  extends Partial<Omit<CleanupConfig, 'features' | 'burn' | 'swap' | 'jupiter'>> {
  features?: Partial<Record<SwitchablePlatform, Partial<Record<Feature, boolean>>>>;
  burn?: Partial<CleanupConfig['burn']>;
  swap?: Partial<CleanupConfig['swap']>;
  jupiter?: Partial<CleanupConfig['jupiter']>;
}

export function createConfig(overrides: ConfigOverrides = {}): CleanupConfig {
  const d = DEFAULT_CONFIG;
  const config: CleanupConfig = {
    ...d,
    ...overrides,
    features: {
      android: { ...d.features.android, ...overrides.features?.android },
      web: { ...d.features.web, ...overrides.features?.web },
    },
    burn: { ...d.burn, ...overrides.burn },
    swap: { ...d.swap, ...overrides.swap },
    jupiter: {
      ...d.jupiter,
      ...overrides.jupiter,
      programIds: [...(overrides.jupiter?.programIds ?? d.jupiter.programIds)],
    },
  };
  validateConfig(config);
  return config;
}

function fail(message: string): never {
  throw new CleanupError('INVALID_CONFIG', message);
}

function checkBps(name: string, value: number, max: number): void {
  if (!Number.isInteger(value) || value < 0 || value > max) {
    fail(`${name} must be an integer from 0 to ${max}, got ${value}`);
  }
}

function checkPositive(name: string, value: number): void {
  if (!Number.isFinite(value) || value <= 0) fail(`${name} must be a positive number`);
}

export function validateConfig(c: CleanupConfig): void {
  if (c.cluster !== 'devnet' && c.cluster !== 'mainnet-beta') fail(`unknown cluster ${String(c.cluster)}`);
  checkBps('cleanupFeeBps', c.cleanupFeeBps, MAX_CLEANUP_FEE_BPS);
  checkBps('swapFeeBps', c.swapFeeBps, MAX_SWAP_FEE_BPS);
  checkBps('swap.slippageBps', c.swap.slippageBps, 10_000);
  const addressOrUnset = (v: string | null) => v === null || v === FEE_WALLET_PLACEHOLDER || isAddress(v);
  if (!addressOrUnset(c.feeWallet)) fail('feeWallet is not a valid address');
  if (!addressOrUnset(c.swapFeeTokenAccount)) fail('swapFeeTokenAccount is not a valid address');
  if (isRealAddress(c.feeWallet) && c.swapFeeBps > 0 && !isRealAddress(c.swapFeeTokenAccount)) {
    fail('swapFeeBps is set but swapFeeTokenAccount is missing');
  }
  if (typeof c.swap.simulationOnly !== 'boolean') fail('swap.simulationOnly must be true or false');
  checkPositive('dustThresholdUsd', c.dustThresholdUsd);
  if (!Number.isFinite(c.burn.maxValueUsd) || c.burn.maxValueUsd < 0) fail('burn.maxValueUsd must be 0 or more');
  if (!Number.isInteger(c.maxTransactionBytes) || c.maxTransactionBytes < 200 || c.maxTransactionBytes > 1232) {
    fail('maxTransactionBytes must be an integer from 200 to 1232');
  }
  checkPositive('maxScanAgeSeconds', c.maxScanAgeSeconds);
  if (!Number.isFinite(c.computeUnitMargin) || c.computeUnitMargin < 1 || c.computeUnitMargin > 3) {
    fail('computeUnitMargin must be from 1 to 3');
  }
  if (!Number.isFinite(c.swap.maxPriceImpact) || c.swap.maxPriceImpact < 0 || c.swap.maxPriceImpact > 1) {
    fail('swap.maxPriceImpact must be a ratio from 0 to 1');
  }
  if (!Number.isInteger(c.swap.maxAccounts) || c.swap.maxAccounts < 8 || c.swap.maxAccounts > 64) {
    fail('swap.maxAccounts must be an integer from 8 to 64');
  }
  if (!Number.isInteger(c.swap.maxComputeUnitPriceMicroLamports) || c.swap.maxComputeUnitPriceMicroLamports < 0) {
    fail('swap.maxComputeUnitPriceMicroLamports must be a non-negative integer');
  }
  for (const url of [c.jupiter.swapBaseUrl, c.jupiter.priceUrl]) {
    if (!/^https:\/\/[a-z0-9.-]+(\/[A-Za-z0-9._/-]*)?$/.test(url)) fail(`not an https URL: ${url}`);
  }
  if (c.jupiter.programIds.length === 0 || !c.jupiter.programIds.every((p) => isAddress(p))) {
    fail('jupiter.programIds must be a non-empty list of addresses');
  }
}

/**
 * iOS is always off: Apple allows swaps only for licensed exchanges, and the
 * owner decided cleanup follows the same rule. Changing that is a code change.
 */
export function isFeatureEnabled(config: CleanupConfig, platform: Platform, feature: Feature): boolean {
  if (platform === 'ios') return false;
  return config.features[platform][feature];
}

function isRealAddress(v: string | null): v is string {
  return v !== null && v !== FEE_WALLET_PLACEHOLDER && isAddress(v);
}

/** True when a fee instruction goes into cleanup transactions. Never to the user. */
export function cleanupFeeActive(config: CleanupConfig): boolean {
  return isRealAddress(config.feeWallet) && config.cleanupFeeBps > 0;
}

export function swapFeeActive(config: CleanupConfig): boolean {
  return isRealAddress(config.feeWallet) && config.swapFeeBps > 0 && isRealAddress(config.swapFeeTokenAccount);
}

/**
 * Guard for every function that builds a transaction. Swaps in simulation-only
 * mode may run on mainnet, because they never produce signable bytes.
 */
export function assertCanBuild(config: CleanupConfig, platform: Platform, feature: Feature): void {
  if (!isFeatureEnabled(config, platform, feature)) {
    throw new CleanupError('FEATURE_DISABLED', `${feature} is switched off on ${platform}`);
  }
  if (config.feeWallet === FEE_WALLET_PLACEHOLDER || config.swapFeeTokenAccount === FEE_WALLET_PLACEHOLDER) {
    throw new CleanupError('FEE_WALLET_NOT_SET', 'the fee wallet is not set yet');
  }
  const simulationOnly = feature === 'swap' && config.swap.simulationOnly;
  if (config.cluster === 'mainnet-beta' && !config.allowMainnet && !simulationOnly) {
    throw new CleanupError('MAINNET_BLOCKED', 'mainnet transactions are not approved yet');
  }
}

/** Guard for sending a transaction the user signed. Simulation-only never sends. */
export function assertCanSend(config: CleanupConfig): void {
  if (config.cluster === 'mainnet-beta' && !config.allowMainnet) {
    throw new CleanupError('MAINNET_BLOCKED', 'mainnet transactions are not approved yet');
  }
}
