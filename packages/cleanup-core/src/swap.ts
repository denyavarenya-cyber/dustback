import { AccountRole, address, getAddressDecoder, type Instruction, isAddress } from '@solana/kit';
import type { ClassifiedAccount } from './accounts';
import { assertCanBuild, type CleanupConfig, type Platform, swapFeeActive } from './config';
import {
  ADDRESS_LOOKUP_TABLE_PROGRAM,
  ASSOCIATED_TOKEN_PROGRAM,
  ATA_IX,
  COMPUTE_BUDGET_IX,
  COMPUTE_BUDGET_PROGRAM,
  LAMPORTS_PER_SIGNATURE,
  LOOKUP_TABLE_META_SIZE,
  MAX_COMPUTE_UNIT_LIMIT,
  TOKEN_2022_PROGRAM,
  TOKEN_IX,
  TOKEN_PROGRAM,
  U64_MAX,
  WSOL_MINT,
} from './constants';
import { assertFresh } from './fresh';
import { CleanupError } from './errors';
import { readU64le, setComputeUnitLimitInstruction, setComputeUnitPriceInstruction } from './instructions';
import {
  assertCluster,
  decodeBase64,
  getLatestBlockhash,
  getMultipleAccounts,
  getParsedAccount,
  isRecord,
  type RawAccount,
  type RpcTransport,
  simulateTransaction,
} from './rpc';
import type { ScanResult } from './scan';
import { explainSimulationError } from './simulation';
import { type AddressesByLookupTable, compileV0 } from './tx';

export interface SwapRequest {
  /** The user's token account to sell, from the scan. */
  account: string;
  /** Raw amount; defaults to the full balance. */
  amountRaw?: string;
}

export interface SwapFee {
  /** Measured in the simulation of the exact transaction offered. */
  lamports: bigint;
  bps: number;
  recipientAccount: string;
  recipientWallet: string;
}

export interface SwapOffer {
  /** Signable bytes; null in simulation-only mode, so no wallet can be asked to sign. */
  base64: string | null;
  simulationOnly: boolean;
  bytes: number;
  inputAccount: string;
  inputMint: string;
  inAmountRaw: bigint;
  decimals: number;
  quote: {
    outLamports: bigint;
    /** Least the swap may deliver before it fails (slippage bound). */
    minOutLamports: bigint;
    priceImpact: number;
    slippageBps: number;
    route: string[];
  };
  /** Jupiter integrator fee inside the swap instruction; null when off. */
  fee: SwapFee | null;
  simulated: {
    ownerLamportsDelta: bigint;
    inputDeltaRaw: bigint;
    unitsConsumed: number | null;
  };
  networkFeeLamports: bigint;
  computeUnitLimit: number;
  computeUnitPriceMicroLamports: bigint;
  /** Swap blockhashes expire within about a minute: build right before signing. */
  lastValidBlockHeight: bigint;
}

interface RawInstruction {
  programId: string;
  accounts: { pubkey: string; isSigner: boolean; isWritable: boolean }[];
  data: Uint8Array;
}

export interface BuildResponse {
  outAmount: bigint;
  otherAmountThreshold: bigint;
  priceImpact: number;
  slippageBps: number;
  route: string[];
  computeBudget: RawInstruction[];
  instructions: RawInstruction[];
  swapInstruction: RawInstruction;
  lookupTables: Record<string, string[]>;
}

const SWAPPABLE = new Set(['dust', 'valuable', 'noMarket']);

function unsafe(message: string): never {
  throw new CleanupError('UNSAFE_TRANSACTION', message);
}

function badJupiter(what: string): never {
  throw new CleanupError('BAD_RESPONSE', `unexpected Jupiter response: ${what}`);
}

function parseInstruction(v: unknown, what: string): RawInstruction {
  if (!isRecord(v) || typeof v.programId !== 'string' || !isAddress(v.programId)) badJupiter(`${what} programId`);
  if (!Array.isArray(v.accounts)) badJupiter(`${what} accounts`);
  const accounts = v.accounts.map((a) => {
    if (!isRecord(a) || typeof a.pubkey !== 'string' || !isAddress(a.pubkey)) badJupiter(`${what} account`);
    if (typeof a.isSigner !== 'boolean' || typeof a.isWritable !== 'boolean') badJupiter(`${what} account flags`);
    return { pubkey: a.pubkey, isSigner: a.isSigner, isWritable: a.isWritable };
  });
  return { programId: v.programId, accounts, data: decodeBase64(v.data, `${what} data`) };
}

/** Route labels are third party text: keep letters, digits, spaces, dots and dashes only. */
function cleanLabel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.replace(/[^A-Za-z0-9 .-]/g, '').slice(0, 32).trim();
  return s === '' ? null : s;
}

/** Validates a /build response against what was asked. Untrusted input. */
export function parseBuildResponse(
  body: unknown,
  expected: { inputMint: string; amount: bigint; maxSlippageBps: number; maxPriceImpact: number },
): BuildResponse {
  if (!isRecord(body)) badJupiter('not an object');
  if (body.inputMint !== expected.inputMint) badJupiter('input mint differs from the request');
  if (body.outputMint !== WSOL_MINT) badJupiter('output mint is not SOL');
  if (toBigIntOr(body.inAmount) !== expected.amount) badJupiter('input amount differs from the request');
  if (body.swapMode !== undefined && body.swapMode !== 'ExactIn') badJupiter('swap mode is not ExactIn');
  if (body.transactionVersion !== undefined && body.transactionVersion !== 0) badJupiter('transaction version is not 0');
  if (body.tipInstruction !== undefined && body.tipInstruction !== null) badJupiter('unrequested tip instruction');
  const outAmount = toBigIntOr(body.outAmount);
  const minOut = toBigIntOr(body.otherAmountThreshold);
  if (outAmount === null || minOut === null || minOut > outAmount || outAmount === 0n) badJupiter('amounts');
  const slippageBps = body.slippageBps;
  if (typeof slippageBps !== 'number' || slippageBps < 0 || slippageBps > expected.maxSlippageBps) {
    badJupiter('slippage above the configured limit');
  }
  const impact = typeof body.priceImpactPct === 'string' ? Math.abs(Number(body.priceImpactPct)) : NaN;
  if (!Number.isFinite(impact)) badJupiter('price impact');
  if (impact > expected.maxPriceImpact) {
    throw new CleanupError('NOT_SWAPPABLE', 'the price impact is too high for this balance');
  }
  const list = (v: unknown, what: string): RawInstruction[] => {
    if (v === undefined || v === null) return [];
    if (!Array.isArray(v)) badJupiter(what);
    return v.map((x, i) => parseInstruction(x, `${what}[${i}]`));
  };
  const swapInstruction = parseInstruction(body.swapInstruction, 'swapInstruction');
  const cleanup = body.cleanupInstruction ? [parseInstruction(body.cleanupInstruction, 'cleanupInstruction')] : [];
  const lookupTables: Record<string, string[]> = {};
  const map = body.addressesByLookupTableAddress;
  if (map !== undefined && map !== null) {
    if (!isRecord(map)) badJupiter('lookup tables');
    for (const [table, addrs] of Object.entries(map)) {
      if (!isAddress(table) || !Array.isArray(addrs) || !addrs.every((a) => typeof a === 'string' && isAddress(a))) {
        badJupiter('lookup table entry');
      }
      lookupTables[table] = addrs as string[];
    }
  }
  const route = Array.isArray(body.routePlan)
    ? body.routePlan
        .map((step) => (isRecord(step) && isRecord(step.swapInfo) ? cleanLabel(step.swapInfo.label) : null))
        .filter((l): l is string => l !== null)
    : [];
  return {
    outAmount,
    otherAmountThreshold: minOut,
    priceImpact: impact,
    slippageBps,
    route,
    computeBudget: list(body.computeBudgetInstructions, 'computeBudgetInstructions'),
    instructions: [
      ...list(body.setupInstructions, 'setupInstructions'),
      swapInstruction,
      ...cleanup,
      ...list(body.otherInstructions, 'otherInstructions'),
    ],
    swapInstruction,
    lookupTables,
  };
}

function toBigIntOr(v: unknown): bigint | null {
  return typeof v === 'string' && /^[0-9]{1,20}$/.test(v) ? BigInt(v) : null;
}

export interface SwapCheckContext {
  owner: string;
  inputAccount: string;
  inputMint: string;
  /** Every token account of the owner from the scan. */
  userAccounts: ReadonlyMap<string, ClassifiedAccount>;
  feeAccount: string | null;
  jupiterPrograms: readonly string[];
  maxComputeUnitPriceMicroLamports: number;
}

/**
 * Static checks on every instruction Jupiter returned. Anything not on the
 * allowlist is refused: the user is never asked to sign it.
 */
export function checkSwapInstructions(response: BuildResponse, ctx: SwapCheckContext): bigint {
  let cuPrice = 0n;
  for (const ix of response.computeBudget) {
    if (ix.programId !== COMPUTE_BUDGET_PROGRAM || ix.accounts.length > 0) unsafe('unexpected compute budget instruction');
    if (ix.data[0] !== COMPUTE_BUDGET_IX.SetComputeUnitPrice || ix.data.length !== 9) {
      unsafe('only a compute unit price is accepted from Jupiter');
    }
    const price = readU64le(ix.data, 1);
    if (price > BigInt(ctx.maxComputeUnitPriceMicroLamports)) unsafe('compute unit price above the configured cap');
    if (price > cuPrice) cuPrice = price;
  }

  const isOtherUserAccount = (addr: string): boolean => {
    const a = ctx.userAccounts.get(addr);
    return a !== undefined && addr !== ctx.inputAccount && !a.isNative;
  };

  for (const ix of response.instructions) {
    for (const acc of ix.accounts) {
      if (acc.isSigner && acc.pubkey !== ctx.owner) unsafe(`a second signer is required (${acc.pubkey})`);
      if (acc.isWritable && isOtherUserAccount(acc.pubkey)) {
        unsafe(`the swap would modify another token account of the user (${acc.pubkey})`);
      }
    }
    const at = (i: number): string | undefined => ix.accounts[i]?.pubkey;
    if (ix.programId === TOKEN_PROGRAM || ix.programId === TOKEN_2022_PROGRAM) {
      const kind = ix.data[0];
      if (kind === TOKEN_IX.CloseAccount) {
        if (at(1) !== ctx.owner || at(2) !== ctx.owner) unsafe('a close sends lamports away from the user');
        const closed = at(0);
        if (closed === undefined || closed === ctx.inputAccount || isOtherUserAccount(closed)) {
          unsafe('the swap would close a token account of the user');
        }
      } else if (kind === TOKEN_IX.SyncNative) {
        const synced = at(0);
        if (synced === undefined || isOtherUserAccount(synced)) unsafe('unexpected sync');
      } else {
        unsafe(`token instruction ${String(kind)} is not allowed in a swap`);
      }
    } else if (ix.programId === ASSOCIATED_TOKEN_PROGRAM) {
      const kind = ix.data.length === 0 ? ATA_IX.Create : ix.data[0];
      if (kind !== ATA_IX.Create && kind !== ATA_IX.CreateIdempotent) unsafe('unexpected associated token instruction');
      if (at(0) !== ctx.owner || at(2) !== ctx.owner) unsafe('an account would be created for someone else');
      if (at(3) !== WSOL_MINT && at(3) !== ctx.inputMint) unsafe('an account for an unrelated mint would be created');
    } else if (!ctx.jupiterPrograms.includes(ix.programId)) {
      unsafe(`program ${ix.programId} is not allowed in a swap`);
    }
  }

  if (!ctx.jupiterPrograms.includes(response.swapInstruction.programId)) unsafe('the swap is not a Jupiter instruction');
  const swapAccounts = response.swapInstruction.accounts;
  if (!swapAccounts.some((a) => a.pubkey === ctx.inputAccount && a.isWritable)) {
    unsafe('the swap does not spend the selected account');
  }
  if (ctx.feeAccount !== null && !swapAccounts.some((a) => a.pubkey === ctx.feeAccount && a.isWritable)) {
    unsafe('the configured fee account is missing from the swap');
  }
  return cuPrice;
}

function toKitInstruction(ix: RawInstruction): Instruction {
  return {
    programAddress: address(ix.programId),
    accounts: ix.accounts.map((a) => ({
      address: address(a.pubkey),
      role: a.isSigner
        ? a.isWritable
          ? AccountRole.WRITABLE_SIGNER
          : AccountRole.READONLY_SIGNER
        : a.isWritable
          ? AccountRole.WRITABLE
          : AccountRole.READONLY,
    })),
    data: ix.data,
  };
}

const addressDecoder = getAddressDecoder();

/** Lookup table contents as stored on chain. Jupiter's copy is only a hint. */
export function parseLookupTable(account: RawAccount | null, table: string): string[] {
  if (account === null || account.owner !== ADDRESS_LOOKUP_TABLE_PROGRAM) unsafe(`lookup table ${table} not found`);
  const d = account.data;
  if (d.length < LOOKUP_TABLE_META_SIZE || (d.length - LOOKUP_TABLE_META_SIZE) % 32 !== 0) unsafe('malformed lookup table');
  if (new DataView(d.buffer, d.byteOffset, d.byteLength).getUint32(0, true) !== 1) unsafe('not a lookup table');
  if (readU64le(d, 4) !== U64_MAX) unsafe(`lookup table ${table} is being deactivated`);
  const out: string[] = [];
  for (let off = LOOKUP_TABLE_META_SIZE; off < d.length; off += 32) {
    out.push(addressDecoder.decode(d.subarray(off, off + 32)));
  }
  return out;
}

async function verifiedLookupTables(
  rpc: RpcTransport,
  claimed: Record<string, string[]>,
): Promise<AddressesByLookupTable> {
  const tables = Object.keys(claimed);
  const accounts = await getMultipleAccounts(rpc, tables);
  const out: AddressesByLookupTable = {};
  tables.forEach((table, i) => {
    const onChain = parseLookupTable(accounts[i] ?? null, table);
    const hint = claimed[table] ?? [];
    if (hint.length > onChain.length || hint.some((a, j) => onChain[j] !== a)) {
      unsafe(`lookup table ${table} differs from the chain`);
    }
    out[table] = onChain;
  });
  return out;
}

async function assertFeeAccount(rpc: RpcTransport, feeAccount: string, feeWallet: string): Promise<void> {
  const v = await getParsedAccount(rpc, feeAccount);
  const ok =
    isRecord(v) &&
    v.owner === TOKEN_PROGRAM &&
    isRecord(v.data) &&
    v.data.program === 'spl-token' &&
    isRecord(v.data.parsed) &&
    v.data.parsed.type === 'account' &&
    isRecord(v.data.parsed.info) &&
    v.data.parsed.info.mint === WSOL_MINT &&
    v.data.parsed.info.owner === feeWallet &&
    v.data.parsed.info.state === 'initialized';
  if (!ok) {
    throw new CleanupError('FEE_ACCOUNT_INVALID', 'the swap fee account is not a SOL token account of the fee wallet');
  }
}

function tokenAmount(a: RawAccount | null | undefined): bigint | null {
  if (a === null || a === undefined || a.data.length < 72) return null;
  return readU64le(a.data, 64);
}

async function fetchBuild(
  config: CleanupConfig,
  params: Record<string, string>,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<unknown> {
  const query = new URLSearchParams(params).toString();
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetchImpl(`${config.jupiter.swapBaseUrl}/build?${query}`, {
      headers: config.jupiter.apiKey ? { 'x-api-key': config.jupiter.apiKey } : {},
      signal: controller.signal,
    });
    if (!res.ok) badJupiter(`HTTP ${res.status}`);
    return await res.json();
  } catch (e) {
    if (e instanceof CleanupError) throw e;
    throw new CleanupError('BAD_RESPONSE', 'Jupiter could not be reached', e);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Builds one swap of a selected token to SOL, with the Jupiter integrator fee
 * from config, and simulates the exact bytes. Call it right before the wallet
 * opens: the blockhash lives about a minute.
 */
export async function prepareSwap(args: {
  rpc: RpcTransport;
  scan: ScanResult;
  request: SwapRequest;
  config: CleanupConfig;
  platform: Platform;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  now?: Date;
}): Promise<SwapOffer> {
  const { rpc, scan, config } = args;
  assertCanBuild(config, args.platform, 'swap');
  assertFresh(scan, config, args.now ?? new Date());
  const account = scan.accounts.find((a) => a.address === args.request.account);
  if (account === undefined) throw new CleanupError('NOT_IN_SCAN', 'the account is not in the scan');
  if (account.protected) throw new CleanupError('PROTECTED', 'NFTs are never swapped here');
  if (!SWAPPABLE.has(account.category) || account.isNative) {
    throw new CleanupError('NOT_SWAPPABLE', `a ${account.category} account cannot be swapped`);
  }
  const amount = args.request.amountRaw === undefined ? account.amountRaw : toBigIntOr(args.request.amountRaw);
  if (amount === null || amount <= 0n || amount > account.amountRaw) {
    throw new CleanupError('NOT_SWAPPABLE', 'the amount must be above zero and at most the balance');
  }

  await assertCluster(rpc, config.cluster);
  const feeOn = swapFeeActive(config);
  const feeAccount = feeOn ? config.swapFeeTokenAccount : null;
  if (feeAccount !== null && config.feeWallet !== null) await assertFeeAccount(rpc, feeAccount, config.feeWallet);

  const params: Record<string, string> = {
    inputMint: account.mint,
    outputMint: WSOL_MINT,
    amount: amount.toString(),
    taker: scan.owner,
    slippageBps: String(config.swap.slippageBps),
    maxAccounts: String(config.swap.maxAccounts),
    wrapAndUnwrapSol: 'true',
    transactionVersion: '0',
  };
  if (feeAccount !== null) {
    params.platformFeeBps = String(config.swapFeeBps);
    params.feeAccount = feeAccount;
  }
  const body = await fetchBuild(config, params, args.fetchImpl ?? fetch, args.timeoutMs ?? 20_000);
  const response = parseBuildResponse(body, {
    inputMint: account.mint,
    amount,
    maxSlippageBps: config.swap.slippageBps,
    maxPriceImpact: config.swap.maxPriceImpact,
  });
  const cuPrice = checkSwapInstructions(response, {
    owner: scan.owner,
    inputAccount: account.address,
    inputMint: account.mint,
    userAccounts: new Map(scan.accounts.map((a) => [a.address, a])),
    feeAccount,
    jupiterPrograms: config.jupiter.programIds,
    maxComputeUnitPriceMicroLamports: config.swap.maxComputeUnitPriceMicroLamports,
  });

  const tables = await verifiedLookupTables(rpc, response.lookupTables);
  const lifetime = await getLatestBlockhash(rpc);
  const body_ = response.instructions.map(toKitInstruction);
  const withBudget = (limit: number): Instruction[] => [
    setComputeUnitLimitInstruction(limit),
    ...(cuPrice > 0n ? [setComputeUnitPriceInstruction(cuPrice)] : []),
    ...body_,
  ];

  const probe = compileV0(scan.owner, lifetime, withBudget(MAX_COMPUTE_UNIT_LIMIT), tables);
  if (probe.bytes > Math.min(probe.sizeLimit, config.maxTransactionBytes)) {
    throw new CleanupError('TOO_LARGE', 'the swap route does not fit in one transaction');
  }
  const first = await simulateTransaction(rpc, probe.base64);
  if (first.err !== null) {
    throw new CleanupError('SIMULATION_FAILED', explainSimulationError(first.err, first.logs), first.logs);
  }
  const used = first.unitsConsumed ?? MAX_COMPUTE_UNIT_LIMIT;
  const cuLimit = Math.min(MAX_COMPUTE_UNIT_LIMIT, Math.max(1_000, Math.ceil(used * config.computeUnitMargin)));
  const final = compileV0(scan.owner, lifetime, withBudget(cuLimit), tables);

  const watch = [scan.owner, account.address, ...(feeAccount !== null ? [feeAccount] : [])];
  const before = await getMultipleAccounts(rpc, watch);
  const check = await simulateTransaction(rpc, final.base64, watch);
  if (check.err !== null) {
    throw new CleanupError('SIMULATION_FAILED', explainSimulationError(check.err, check.logs), check.logs);
  }
  const [ownerBefore, inputBefore, feeBefore] = before;
  const [ownerAfter, inputAfter, feeAfter] = check.accounts;
  if (ownerBefore == null || ownerAfter == null) unsafe('the owner account is missing from the simulation');
  const inBefore = tokenAmount(inputBefore);
  const inAfter = tokenAmount(inputAfter);
  if (inBefore === null || inAfter === null) unsafe('the input account is missing from the simulation');
  const inputDelta = inAfter - inBefore;
  if (inputDelta !== -amount) unsafe('the simulation spends a different amount than selected');

  let fee: SwapFee | null = null;
  if (feeAccount !== null && config.feeWallet !== null) {
    const fb = tokenAmount(feeBefore);
    const fa = tokenAmount(feeAfter);
    if (fb === null || fa === null || fa < fb) unsafe('the fee could not be measured in the simulation');
    const measured = fa - fb;
    // Never more than the configured share of what the route produced (1 lamport rounding).
    const gross = response.outAmount + measured;
    if (measured * 10_000n > BigInt(config.swapFeeBps) * gross + 10_000n) unsafe('the fee is above the configured rate');
    fee = { lamports: measured, bps: config.swapFeeBps, recipientAccount: feeAccount, recipientWallet: config.feeWallet };
  }

  const priority = (BigInt(cuLimit) * cuPrice + 999_999n) / 1_000_000n;
  return {
    base64: config.swap.simulationOnly ? null : final.base64,
    simulationOnly: config.swap.simulationOnly,
    bytes: final.bytes,
    inputAccount: account.address,
    inputMint: account.mint,
    inAmountRaw: amount,
    decimals: account.decimals,
    quote: {
      outLamports: response.outAmount,
      minOutLamports: response.otherAmountThreshold,
      priceImpact: response.priceImpact,
      slippageBps: response.slippageBps,
      route: response.route,
    },
    fee,
    simulated: {
      ownerLamportsDelta: ownerAfter.lamports - ownerBefore.lamports,
      inputDeltaRaw: inputDelta,
      unitsConsumed: check.unitsConsumed,
    },
    networkFeeLamports: LAMPORTS_PER_SIGNATURE + priority,
    computeUnitLimit: cuLimit,
    computeUnitPriceMicroLamports: cuPrice,
    lastValidBlockHeight: lifetime.lastValidBlockHeight,
  };
}
