import { getAddressDecoder, isAddress } from '@solana/kit';
import { type ClassifiedAccount, PROGRAM_ID } from './accounts';
import {
  assertCanBuild,
  type CleanupConfig,
  cleanupFeeActive,
  type Cluster,
  FEE_WALLET_PLACEHOLDER,
  isFeatureEnabled,
  type Platform,
} from './config';
import { LAMPORTS_PER_SIGNATURE, MAX_COMPUTE_UNIT_LIMIT, TOKEN_2022_PROGRAM } from './constants';
import { CleanupError } from './errors';
import { assertFresh } from './fresh';
import {
  burnCheckedInstruction,
  closeAccountInstruction,
  harvestWithheldInstruction,
  type Instruction,
  setComputeUnitLimitInstruction,
  transferSolInstruction,
} from './instructions';
import { assertCluster, getLatestBlockhash, type LatestBlockhash, type RpcTransport, simulateTransaction } from './rpc';
import type { ScanResult } from './scan';
import { explainSimulationError } from './simulation';
import { compileLegacy, type CompiledTransaction, LEGACY_SIZE_LIMIT, legacySize } from './tx';

function sizeLimitFor(config: CleanupConfig): number {
  return Math.min(LEGACY_SIZE_LIMIT, config.maxTransactionBytes);
}

/** Compiles with kit and checks the real size once more; the count must never be wrong silently. */
function compileChecked(owner: string, lifetime: LatestBlockhash, ixs: Instruction[], config: CleanupConfig): CompiledTransaction {
  const compiled = compileLegacy(owner, lifetime, ixs);
  if (compiled.bytes > Math.min(compiled.sizeLimit, sizeLimitFor(config))) {
    throw new CleanupError('TOO_LARGE', 'a transaction came out larger than the limit');
  }
  return compiled;
}

export interface BurnRequest {
  address: string;
  /** The exact full balance the user confirmed; anything else is refused. */
  amountRaw: string;
}

/** What the user picked, account by account. Nothing is ever selected by default. */
export interface CleanupSelection {
  close: readonly string[];
  burn?: readonly BurnRequest[];
}

export type CleanupAction = 'close' | 'harvestAndClose' | 'unwrap' | 'burnAndClose';

export interface PlannedAccount {
  address: string;
  mint: string;
  action: CleanupAction;
  /** Rent deposit returned; the fee basis. */
  rentLamports: bigint;
  /** Everything the close sends to the owner (rent, plus wrapped SOL for unwrap). */
  returnLamports: bigint;
  burnAmountRaw: bigint | null;
}

export interface CleanupFee {
  lamports: bigint;
  bps: number;
  recipient: string;
}

export interface CleanupTransaction {
  index: number;
  /** Unsigned transaction for the user's wallet. */
  base64: string;
  bytes: number;
  accounts: PlannedAccount[];
  rentLamports: bigint;
  returnLamports: bigint;
  /** The fee instruction inside this transaction; null when no fee is charged. */
  fee: CleanupFee | null;
  networkFeeLamports: bigint;
  /** Change to the owner's SOL: returned minus fee minus network fee. */
  netLamports: bigint;
  computeUnitLimit: number;
  lastValidBlockHeight: bigint;
  unitsConsumed: number | null;
}

export interface RejectedBatch {
  accounts: string[];
  reason: string;
  logs: string[];
}

export interface CleanupTotals {
  accounts: number;
  transactions: number;
  rentLamports: bigint;
  returnLamports: bigint;
  feeLamports: bigint;
  networkFeeLamports: bigint;
  netLamports: bigint;
}

export interface CleanupOffer {
  owner: string;
  cluster: Cluster;
  /** Only transactions whose final bytes passed simulation. */
  transactions: CleanupTransaction[];
  rejected: RejectedBatch[];
  totals: CleanupTotals;
}

interface SelectedItem {
  account: ClassifiedAccount;
  action: CleanupAction;
  burnAmount: bigint | null;
}

const CLOSE_CATEGORIES = new Set(['empty', 'withheldFees', 'wrappedSol']);
const BURN_CATEGORIES = new Set(['dust', 'noMarket']);

/** Refuses any burn that is not explicitly allowed. NFTs are never burned. */
export function assertBurnAllowed(account: ClassifiedAccount, amountRaw: string, config: CleanupConfig): void {
  if (account.protected) {
    throw new CleanupError('PROTECTED', `${account.address} looks like an NFT and is never burned`);
  }
  if (!config.burn.enabled) throw new CleanupError('BURN_REFUSED', 'burning is switched off');
  if (!BURN_CATEGORIES.has(account.category)) {
    throw new CleanupError('BURN_REFUSED', `${account.address} is ${account.category} and cannot be burned`);
  }
  if (!/^[0-9]{1,20}$/.test(amountRaw) || BigInt(amountRaw) !== account.amountRaw) {
    throw new CleanupError('BURN_REFUSED', 'the confirmed amount must equal the full balance from the scan');
  }
  if (account.valueUsd === null) {
    if (!config.burn.allowUnpriced) {
      throw new CleanupError('BURN_REFUSED', 'the token has no price, so its value cannot be checked');
    }
  } else if (account.valueUsd > config.burn.maxValueUsd) {
    throw new CleanupError('BURN_REFUSED', `the balance is worth more than ${config.burn.maxValueUsd} USD`);
  }
}

/** Turns the user's selection into actions, refusing anything not allowed. */
export function selectAccounts(
  scan: ScanResult,
  selection: CleanupSelection,
  config: CleanupConfig,
): SelectedItem[] {
  const byAddress = new Map(scan.accounts.map((a) => [a.address, a]));
  const seen = new Set<string>();
  const take = (addr: string): ClassifiedAccount => {
    if (typeof addr !== 'string' || !isAddress(addr)) throw new CleanupError('INVALID_ADDRESS', 'invalid account address');
    if (seen.has(addr)) throw new CleanupError('NOT_CLOSABLE', `${addr} is selected twice`);
    seen.add(addr);
    const account = byAddress.get(addr);
    if (account === undefined) throw new CleanupError('NOT_IN_SCAN', `${addr} is not in the scan`);
    if (account.owner !== scan.owner) throw new CleanupError('NOT_IN_SCAN', `${addr} belongs to another owner`);
    return account;
  };

  const chosen = new Map<string, SelectedItem>();
  for (const addr of selection.close) {
    const account = take(addr);
    if (account.protected) throw new CleanupError('PROTECTED', `${addr} looks like an NFT and is never closed`);
    if (!account.closable || !CLOSE_CATEGORIES.has(account.category)) {
      const why = account.reasons.map((r) => r.code).join(', ') || account.category;
      throw new CleanupError('NOT_CLOSABLE', `${addr} cannot be closed (${why})`);
    }
    const action: CleanupAction =
      account.category === 'wrappedSol' ? 'unwrap' : account.needsHarvest ? 'harvestAndClose' : 'close';
    chosen.set(addr, { account, action, burnAmount: null });
  }
  for (const req of selection.burn ?? []) {
    const account = take(req.address);
    assertBurnAllowed(account, req.amountRaw, config);
    chosen.set(req.address, { account, action: 'burnAndClose', burnAmount: account.amountRaw });
  }
  // Keep scan order so the same selection always gives the same transactions.
  return scan.accounts.flatMap((a) => {
    const item = chosen.get(a.address);
    return item ? [item] : [];
  });
}

function accountInstructions(owner: string, item: SelectedItem): Instruction[] {
  const a = item.account;
  const programId = PROGRAM_ID[a.program];
  const out: Instruction[] = [];
  if (a.needsHarvest && a.program === 'token2022') {
    out.push(harvestWithheldInstruction(TOKEN_2022_PROGRAM, a.mint, [a.address]));
  }
  if (item.action === 'burnAndClose' && item.burnAmount !== null) {
    out.push(burnCheckedInstruction(programId, a.address, a.mint, owner, item.burnAmount, a.decimals));
  }
  out.push(closeAccountInstruction(programId, a.address, owner, owner));
  return out;
}

function feeFor(rentLamports: bigint, config: CleanupConfig): bigint {
  if (!cleanupFeeActive(config)) return 0n;
  return (rentLamports * BigInt(config.cleanupFeeBps)) / 10_000n;
}

interface Batch {
  items: SelectedItem[];
  rentLamports: bigint;
  feeLamports: bigint;
}

function batchInstructions(owner: string, batch: Batch, config: CleanupConfig, cuLimit: number): Instruction[] {
  const ixs: Instruction[] = [setComputeUnitLimitInstruction(cuLimit)];
  for (const item of batch.items) ixs.push(...accountInstructions(owner, item));
  if (batch.feeLamports > 0n && config.feeWallet !== null) {
    // The fee is its own instruction, last in the same transaction, so the
    // wallet shows it as a separate transfer with its exact amount.
    ixs.push(transferSolInstruction(owner, config.feeWallet, batch.feeLamports));
  }
  return ixs;
}

/**
 * Groups selected accounts into transactions, each measured against the size
 * limit with its fee instruction included. Pure: no network.
 */
export function batchSelection(owner: string, items: SelectedItem[], config: CleanupConfig): Batch[] {
  const limit = sizeLimitFor(config);
  const make = (list: SelectedItem[]): Batch => {
    const rent = list.reduce((s, i) => s + i.account.rentLamports, 0n);
    return { items: list, rentLamports: rent, feeLamports: feeFor(rent, config) };
  };
  const fits = (list: SelectedItem[]): boolean => {
    const batch = make(list);
    // Measure with a fee instruction whenever fees are on, so rounding a fee
    // to zero can never be what lets a batch fit.
    const probe = { ...batch, feeLamports: cleanupFeeActive(config) ? 1n : 0n };
    return legacySize(owner, batchInstructions(owner, probe, config, MAX_COMPUTE_UNIT_LIMIT)) <= limit;
  };

  const batches: Batch[] = [];
  let current: SelectedItem[] = [];
  for (const item of items) {
    const candidate = [...current, item];
    if (fits(candidate)) {
      current = candidate;
      continue;
    }
    if (current.length === 0) {
      throw new CleanupError('TOO_LARGE', `${item.account.address} does not fit in one transaction`);
    }
    batches.push(make(current));
    current = [item];
    if (!fits(current)) throw new CleanupError('TOO_LARGE', `${item.account.address} does not fit in one transaction`);
  }
  if (current.length > 0) batches.push(make(current));
  return batches;
}

function describe(
  index: number,
  batch: Batch,
  config: CleanupConfig,
  compiled: { base64: string; bytes: number },
  cuLimit: number,
  lifetime: LatestBlockhash,
  unitsConsumed: number | null,
): CleanupTransaction {
  const accounts: PlannedAccount[] = batch.items.map((i) => ({
    address: i.account.address,
    mint: i.account.mint,
    action: i.action,
    rentLamports: i.account.rentLamports,
    returnLamports: i.account.returnLamports,
    burnAmountRaw: i.burnAmount,
  }));
  const returnLamports = accounts.reduce((s, a) => s + a.returnLamports, 0n);
  const fee =
    batch.feeLamports > 0n && config.feeWallet !== null
      ? { lamports: batch.feeLamports, bps: config.cleanupFeeBps, recipient: config.feeWallet }
      : null;
  const networkFeeLamports = LAMPORTS_PER_SIGNATURE;
  return {
    index,
    base64: compiled.base64,
    bytes: compiled.bytes,
    accounts,
    rentLamports: batch.rentLamports,
    returnLamports,
    fee,
    networkFeeLamports,
    netLamports: returnLamports - (fee?.lamports ?? 0n) - networkFeeLamports,
    computeUnitLimit: cuLimit,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
    unitsConsumed,
  };
}

/** Unsimulated plan with the maximum compute limit. Pure; for previews and tests. */
export function planCleanup(args: {
  scan: ScanResult;
  selection: CleanupSelection;
  config: CleanupConfig;
  platform: Platform;
  lifetime: LatestBlockhash;
  now?: Date;
}): CleanupTransaction[] {
  const { scan, config } = args;
  assertCanBuild(config, args.platform, 'cleanup');
  assertFresh(scan, config, args.now ?? new Date());
  const items = selectAccounts(scan, args.selection, config);
  return batchSelection(scan.owner, items, config).map((batch, i) => {
    const compiled = compileChecked(
      scan.owner,
      args.lifetime,
      batchInstructions(scan.owner, batch, config, MAX_COMPUTE_UNIT_LIMIT),
      config,
    );
    return describe(i, batch, config, compiled, MAX_COMPUTE_UNIT_LIMIT, args.lifetime, null);
  });
}

export interface CleanupPreviewTransaction {
  index: number;
  accounts: PlannedAccount[];
  rentLamports: bigint;
  returnLamports: bigint;
  feeLamports: bigint;
  networkFeeLamports: bigint;
  netLamports: bigint;
}

export interface CleanupPreview {
  owner: string;
  cluster: Cluster;
  feeBps: number;
  /** null while the fee wallet is not set, or when the owner chose no fee. */
  feeRecipient: string | null;
  /** False while the fee wallet is the placeholder: nothing can be signed yet. */
  feeWalletSet: boolean;
  transactions: CleanupPreviewTransaction[];
  totals: CleanupTotals;
}

// Stands in for the fee wallet when measuring sizes: same byte count as any address.
const PREVIEW_FEE_RECIPIENT = getAddressDecoder().decode(new Uint8Array(32).fill(7));

/**
 * The numbers the scan screen shows for a selection, computed with the same
 * batching and fee rounding as prepareCleanup, without the network and
 * without producing any signable bytes.
 */
export function previewCleanup(args: {
  scan: ScanResult;
  selection: CleanupSelection;
  config: CleanupConfig;
  platform: Platform;
  now?: Date;
}): CleanupPreview {
  const { scan, config } = args;
  if (!isFeatureEnabled(config, args.platform, 'cleanup')) {
    throw new CleanupError('FEATURE_DISABLED', `cleanup is switched off on ${args.platform}`);
  }
  if (config.cluster === 'mainnet-beta' && !config.allowMainnet) {
    throw new CleanupError('MAINNET_BLOCKED', 'mainnet transactions are not approved yet');
  }
  assertFresh(scan, config, args.now ?? new Date());
  const feeWalletSet = config.feeWallet !== FEE_WALLET_PLACEHOLDER;
  const measureConfig: CleanupConfig = feeWalletSet ? config : { ...config, feeWallet: PREVIEW_FEE_RECIPIENT };
  const items = selectAccounts(scan, args.selection, measureConfig);
  const transactions = batchSelection(scan.owner, items, measureConfig).map((batch, index) => {
    const accounts: PlannedAccount[] = batch.items.map((i) => ({
      address: i.account.address,
      mint: i.account.mint,
      action: i.action,
      rentLamports: i.account.rentLamports,
      returnLamports: i.account.returnLamports,
      burnAmountRaw: i.burnAmount,
    }));
    const returnLamports = accounts.reduce((s, a) => s + a.returnLamports, 0n);
    return {
      index,
      accounts,
      rentLamports: batch.rentLamports,
      returnLamports,
      feeLamports: batch.feeLamports,
      networkFeeLamports: LAMPORTS_PER_SIGNATURE,
      netLamports: returnLamports - batch.feeLamports - LAMPORTS_PER_SIGNATURE,
    };
  });
  const totals: CleanupTotals = {
    accounts: transactions.reduce((s, t) => s + t.accounts.length, 0),
    transactions: transactions.length,
    rentLamports: transactions.reduce((s, t) => s + t.rentLamports, 0n),
    returnLamports: transactions.reduce((s, t) => s + t.returnLamports, 0n),
    feeLamports: transactions.reduce((s, t) => s + t.feeLamports, 0n),
    networkFeeLamports: transactions.reduce((s, t) => s + t.networkFeeLamports, 0n),
    netLamports: transactions.reduce((s, t) => s + t.netLamports, 0n),
  };
  return {
    owner: scan.owner,
    cluster: config.cluster,
    feeBps: config.feeWallet === null ? 0 : config.cleanupFeeBps,
    feeRecipient: feeWalletSet ? config.feeWallet : null,
    feeWalletSet,
    transactions,
    totals,
  };
}

function totalsOf(transactions: CleanupTransaction[]): CleanupTotals {
  const t: CleanupTotals = {
    accounts: 0,
    transactions: transactions.length,
    rentLamports: 0n,
    returnLamports: 0n,
    feeLamports: 0n,
    networkFeeLamports: 0n,
    netLamports: 0n,
  };
  for (const tx of transactions) {
    t.accounts += tx.accounts.length;
    t.rentLamports += tx.rentLamports;
    t.returnLamports += tx.returnLamports;
    t.feeLamports += tx.fee?.lamports ?? 0n;
    t.networkFeeLamports += tx.networkFeeLamports;
    t.netLamports += tx.netLamports;
  }
  return t;
}

/**
 * Builds the cleanup transactions for the selection and simulates each one
 * twice: once to measure compute units, once on the exact final bytes. Only
 * transactions whose final bytes pass are offered.
 */
export async function prepareCleanup(args: {
  rpc: RpcTransport;
  scan: ScanResult;
  selection: CleanupSelection;
  config: CleanupConfig;
  platform: Platform;
  now?: Date;
}): Promise<CleanupOffer> {
  const { rpc, scan, config } = args;
  assertCanBuild(config, args.platform, 'cleanup');
  assertFresh(scan, config, args.now ?? new Date());
  const items = selectAccounts(scan, args.selection, config);
  const offer: CleanupOffer = {
    owner: scan.owner,
    cluster: config.cluster,
    transactions: [],
    rejected: [],
    totals: totalsOf([]),
  };
  if (items.length === 0) return offer;

  await assertCluster(rpc, config.cluster);
  const lifetime = await getLatestBlockhash(rpc);
  const batches = batchSelection(scan.owner, items, config);

  for (const batch of batches) {
    const addresses = batch.items.map((i) => i.account.address);
    const reject = (reason: string, logs: string[]) => offer.rejected.push({ accounts: addresses, reason, logs });

    const probe = compileChecked(scan.owner, lifetime, batchInstructions(scan.owner, batch, config, MAX_COMPUTE_UNIT_LIMIT), config);
    const first = await simulateTransaction(rpc, probe.base64);
    if (first.err !== null) {
      reject(explainSimulationError(first.err, first.logs), first.logs);
      continue;
    }
    const used = first.unitsConsumed ?? MAX_COMPUTE_UNIT_LIMIT;
    const cuLimit = Math.min(MAX_COMPUTE_UNIT_LIMIT, Math.max(1_000, Math.ceil(used * config.computeUnitMargin)));
    const final = compileChecked(scan.owner, lifetime, batchInstructions(scan.owner, batch, config, cuLimit), config);
    const check = await simulateTransaction(rpc, final.base64, addresses);
    if (check.err !== null) {
      reject(explainSimulationError(check.err, check.logs), check.logs);
      continue;
    }
    const stillOpen = check.accounts.some((a) => a !== null && a.lamports > 0n);
    if (stillOpen) {
      reject('An account stayed open in the simulation, so this transaction is not offered.', check.logs);
      continue;
    }
    offer.transactions.push(describe(offer.transactions.length, batch, config, final, cuLimit, lifetime, check.unitsConsumed));
  }
  offer.totals = totalsOf(offer.transactions);
  return offer;
}
