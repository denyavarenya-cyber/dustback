import { isAddress } from '@solana/kit';
import type { CleanupConfig } from './config';
import { TOKEN_2022_PROGRAM, TOKEN_PROGRAM } from './constants';
import { isRecord, toBigInt } from './rpc';

export type TokenProgramKind = 'token' | 'token2022';

export const PROGRAM_ID: Record<TokenProgramKind, string> = {
  token: TOKEN_PROGRAM,
  token2022: TOKEN_2022_PROGRAM,
};

const PARSED_PROGRAM_NAME: Record<TokenProgramKind, string> = {
  token: 'spl-token',
  token2022: 'spl-token-2022',
};

/** Facts read from one token account, exactly as the chain reports them. */
export interface TokenAccountFact {
  address: string;
  mint: string;
  owner: string;
  program: TokenProgramKind;
  /** Lamports held by the account (its rent deposit, plus wrapped SOL for native accounts). */
  lamports: bigint;
  amountRaw: bigint;
  decimals: number;
  isNative: boolean;
  state: string;
  closeAuthority: string | null;
  /** Token-2022 extension names as reported by the RPC. */
  extensions: string[];
  /** Token-2022 transfer fees withheld in this account. */
  withheldAmount: bigint;
  /** Rent part of a native (wrapped SOL) account. */
  rentExemptReserve: bigint | null;
}

export type AccountCategory =
  /** Zero balance, can be closed: rent goes back to the owner. */
  | 'empty'
  /** Zero balance with Token-2022 fees withheld; harvested to the mint, then closed. */
  | 'withheldFees'
  /** Wrapped SOL; closing returns the SOL and the rent. */
  | 'wrappedSol'
  /** Balance priced under the dust threshold. Swap candidate, never selected by default. */
  | 'dust'
  /** Balance priced at or above the dust threshold. Left alone. */
  | 'valuable'
  /** Balance without a price. Left alone. */
  | 'noMarket'
  /** Zero decimals and a balance: treated as an NFT. Never closed, burned or swapped. */
  | 'nft'
  /** The account is frozen by the mint's freeze authority. */
  | 'frozen'
  /** Something prevents closing (see reasons). */
  | 'blocked';

export type ReasonCode =
  | 'frozen'
  | 'closeAuthorityElsewhere'
  | 'confidentialTransfer'
  | 'nonTransferableBalance'
  | 'unknownExtension'
  | 'withheldFees'
  | 'nftProtected';

export interface Reason {
  code: ReasonCode;
  detail?: string;
}

export interface ClassifiedAccount extends TokenAccountFact {
  category: AccountCategory;
  closable: boolean;
  /** Withheld Token-2022 fees must be harvested to the mint before closing. */
  needsHarvest: boolean;
  /** Never closed, burned or swapped. */
  protected: boolean;
  /** Rent deposit part; the cleanup fee is computed on this only. */
  rentLamports: bigint;
  /** What closing sends to the owner. */
  returnLamports: bigint;
  priceUsd: number | null;
  valueUsd: number | null;
  reasons: Reason[];
}

/** Extensions that do not stop the owner from closing an empty account. */
const BENIGN_EXTENSIONS = new Set([
  'immutableOwner',
  'memoTransfer',
  'cpiGuard',
  'nonTransferableAccount',
  'transferHookAccount',
  'pausableAccount',
  'transferFeeAmount',
]);

const CONFIDENTIAL_EXTENSIONS = new Set(['confidentialTransferAccount', 'confidentialTransferFeeAmount']);

function uiAmountRaw(v: unknown, what: string): { amount: bigint; decimals: number } {
  if (!isRecord(v)) throw new TypeError(`${what} missing`);
  const decimals = v.decimals;
  if (typeof decimals !== 'number' || !Number.isInteger(decimals) || decimals < 0 || decimals > 255) {
    throw new TypeError(`${what} decimals`);
  }
  return { amount: toBigInt(v.amount, `${what} amount`), decimals };
}

/**
 * Parses one entry of getTokenAccountsByOwner (jsonParsed). Returns null when
 * the entry is malformed or does not belong to the expected owner and program;
 * such entries are counted as skipped and never acted on.
 */
export function parseTokenAccount(
  entry: unknown,
  program: TokenProgramKind,
  expectedOwner: string,
): TokenAccountFact | null {
  try {
    if (!isRecord(entry) || typeof entry.pubkey !== 'string' || !isAddress(entry.pubkey)) return null;
    const account = entry.account;
    if (!isRecord(account) || account.owner !== PROGRAM_ID[program]) return null;
    const data = account.data;
    if (!isRecord(data) || data.program !== PARSED_PROGRAM_NAME[program]) return null;
    const parsed = data.parsed;
    if (!isRecord(parsed) || parsed.type !== 'account' || !isRecord(parsed.info)) return null;
    const info = parsed.info;
    if (typeof info.mint !== 'string' || !isAddress(info.mint)) return null;
    if (info.owner !== expectedOwner) return null;
    const { amount, decimals } = uiAmountRaw(info.tokenAmount, 'tokenAmount');
    const state = typeof info.state === 'string' ? info.state : 'unknown';
    let closeAuthority: string | null = null;
    if (info.closeAuthority !== undefined && info.closeAuthority !== null) {
      if (typeof info.closeAuthority !== 'string' || !isAddress(info.closeAuthority)) return null;
      closeAuthority = info.closeAuthority;
    }
    const extensions: string[] = [];
    let withheldAmount = 0n;
    if (Array.isArray(info.extensions)) {
      for (const ext of info.extensions) {
        if (!isRecord(ext) || typeof ext.extension !== 'string') {
          extensions.push('unparseable');
          continue;
        }
        extensions.push(ext.extension);
        if (ext.extension === 'transferFeeAmount' && isRecord(ext.state)) {
          withheldAmount = toBigInt(ext.state.withheldAmount, 'withheldAmount');
        }
      }
    }
    const isNative = info.isNative === true;
    const rentExemptReserve =
      isNative && info.rentExemptReserve !== undefined
        ? uiAmountRaw(info.rentExemptReserve, 'rentExemptReserve').amount
        : null;
    return {
      address: entry.pubkey,
      mint: info.mint,
      owner: expectedOwner,
      program,
      lamports: toBigInt(account.lamports, 'lamports'),
      amountRaw: amount,
      decimals,
      isNative,
      state,
      closeAuthority,
      extensions,
      withheldAmount,
      rentExemptReserve,
    };
  } catch {
    return null;
  }
}

function rentPart(f: TokenAccountFact): bigint {
  if (!f.isNative) return f.lamports;
  const reserve = f.rentExemptReserve ?? f.lamports - f.amountRaw;
  return reserve < 0n ? 0n : reserve < f.lamports ? reserve : f.lamports;
}

/** USD value of a raw amount; display only, never used for money math. */
export function valueUsd(amountRaw: bigint, decimals: number, priceUsd: number): number {
  return (Number(amountRaw) / 10 ** decimals) * priceUsd;
}

/**
 * Puts one account in exactly one category. Order matters: protection first,
 * then anything that blocks closing, then balances.
 */
export function classifyAccount(
  fact: TokenAccountFact,
  prices: ReadonlyMap<string, number>,
  config: Pick<CleanupConfig, 'dustThresholdUsd'>,
): ClassifiedAccount {
  const reasons: Reason[] = [];
  const priceUsd = prices.get(fact.mint) ?? null;
  const value = priceUsd === null ? null : valueUsd(fact.amountRaw, fact.decimals, priceUsd);
  const base = {
    ...fact,
    needsHarvest: fact.withheldAmount > 0n,
    protected: false,
    closable: false,
    rentLamports: rentPart(fact),
    returnLamports: fact.lamports,
    priceUsd,
    valueUsd: value,
    reasons,
  };
  const nonEmpty = fact.amountRaw > 0n;

  if (nonEmpty && fact.decimals === 0 && !fact.isNative) {
    reasons.push({ code: 'nftProtected' });
    if (fact.state === 'frozen') reasons.push({ code: 'frozen' });
    return { ...base, category: 'nft', protected: true };
  }
  if (fact.state !== 'initialized') {
    reasons.push({ code: 'frozen', detail: fact.state });
    return { ...base, category: 'frozen' };
  }
  if (fact.closeAuthority !== null && fact.closeAuthority !== fact.owner) {
    reasons.push({ code: 'closeAuthorityElsewhere', detail: fact.closeAuthority });
  }
  for (const ext of fact.extensions) {
    if (CONFIDENTIAL_EXTENSIONS.has(ext)) reasons.push({ code: 'confidentialTransfer', detail: ext });
    else if (!BENIGN_EXTENSIONS.has(ext)) reasons.push({ code: 'unknownExtension', detail: ext });
  }
  if (nonEmpty && fact.extensions.includes('nonTransferableAccount')) {
    reasons.push({ code: 'nonTransferableBalance' });
  }
  if (reasons.length > 0) return { ...base, category: 'blocked' };

  if (!nonEmpty) {
    if (fact.withheldAmount > 0n) {
      reasons.push({ code: 'withheldFees', detail: fact.withheldAmount.toString() });
      return { ...base, category: 'withheldFees', closable: true };
    }
    return { ...base, category: 'empty', closable: true };
  }
  if (fact.isNative) return { ...base, category: 'wrappedSol', closable: true };
  if (value === null) return { ...base, category: 'noMarket' };
  if (value < config.dustThresholdUsd) return { ...base, category: 'dust' };
  return { ...base, category: 'valuable' };
}
