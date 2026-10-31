import { isAddress } from '@solana/kit';
import {
  type AccountCategory,
  type ClassifiedAccount,
  classifyAccount,
  parseTokenAccount,
  PROGRAM_ID,
  type TokenAccountFact,
  type TokenProgramKind,
} from './accounts';
import type { CleanupConfig, Cluster } from './config';
import { CleanupError } from './errors';
import type { PriceSource } from './prices';
import { assertCluster, getTokenAccountsByOwner, type RpcTransport } from './rpc';

export interface ScanTotals {
  /** Accounts that can be closed (empty, withheld fees, wrapped SOL). */
  closableCount: number;
  /** Sum of rent deposits of closable accounts; the cleanup fee basis. */
  reclaimableRentLamports: bigint;
  /** Everything closing all closable accounts would send to the owner. */
  returnLamports: bigint;
}

export interface ScanResult {
  owner: string;
  cluster: Cluster;
  /** ISO time of the scan; plans refuse scans older than maxScanAgeSeconds. */
  scannedAt: string;
  accounts: ClassifiedAccount[];
  /** Entries the RPC returned that failed validation; never acted on. */
  skipped: number;
  byCategory: Record<AccountCategory, number>;
  totals: ScanTotals;
}

const CATEGORIES: AccountCategory[] = [
  'empty',
  'withheldFees',
  'wrappedSol',
  'dust',
  'valuable',
  'noMarket',
  'nft',
  'frozen',
  'blocked',
];

/** Mints worth pricing: non-empty, not native, not NFT-like, not blocked. */
function mintsToPrice(facts: TokenAccountFact[]): string[] {
  return [
    ...new Set(
      facts.filter((f) => f.amountRaw > 0n && !f.isNative && f.decimals > 0).map((f) => f.mint),
    ),
  ];
}

export function summarize(
  owner: string,
  cluster: Cluster,
  accounts: ClassifiedAccount[],
  skipped: number,
  scannedAt: string,
): ScanResult {
  const byCategory = Object.fromEntries(CATEGORIES.map((c) => [c, 0])) as Record<AccountCategory, number>;
  const totals: ScanTotals = { closableCount: 0, reclaimableRentLamports: 0n, returnLamports: 0n };
  for (const a of accounts) {
    byCategory[a.category]++;
    if (a.closable) {
      totals.closableCount++;
      totals.reclaimableRentLamports += a.rentLamports;
      totals.returnLamports += a.returnLamports;
    }
  }
  return { owner, cluster, scannedAt, accounts, skipped, byCategory, totals };
}

/** Classification only, from already fetched RPC entries. Pure; used by tests and by scanWallet. */
export async function classifyEntries(args: {
  owner: string;
  cluster: Cluster;
  entries: Record<TokenProgramKind, unknown[]>;
  prices?: PriceSource;
  config: Pick<CleanupConfig, 'dustThresholdUsd'>;
  now?: Date;
}): Promise<ScanResult> {
  const facts: TokenAccountFact[] = [];
  let skipped = 0;
  for (const program of ['token', 'token2022'] as const) {
    for (const entry of args.entries[program]) {
      const fact = parseTokenAccount(entry, program, args.owner);
      if (fact === null) skipped++;
      else facts.push(fact);
    }
  }
  const prices = args.prices ? await args.prices(mintsToPrice(facts)) : new Map<string, number>();
  const accounts = facts.map((f) => classifyAccount(f, prices, args.config));
  return summarize(args.owner, args.cluster, accounts, skipped, (args.now ?? new Date()).toISOString());
}

/**
 * Reads every token account of a public address under both token programs and
 * classifies each one. Read only: nothing is built or signed here.
 */
export async function scanWallet(args: {
  rpc: RpcTransport;
  owner: string;
  config: CleanupConfig;
  prices?: PriceSource;
  now?: Date;
}): Promise<ScanResult> {
  if (!isAddress(args.owner)) throw new CleanupError('INVALID_ADDRESS', 'not a valid Solana address');
  await assertCluster(args.rpc, args.config.cluster);
  const [token, token2022] = await Promise.all([
    getTokenAccountsByOwner(args.rpc, args.owner, PROGRAM_ID.token),
    getTokenAccountsByOwner(args.rpc, args.owner, PROGRAM_ID.token2022),
  ]);
  return classifyEntries({
    owner: args.owner,
    cluster: args.config.cluster,
    entries: { token, token2022 },
    prices: args.prices,
    config: args.config,
    now: args.now,
  });
}
