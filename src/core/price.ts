import { DUST_THRESHOLD_USD } from '../config';
import { TokenBalance } from './scan';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Jupiter free tier: no API key, shared 1 req/s limit across all endpoints.
const PRICE_URL = 'https://lite-api.jup.ag/price/v3';
export const QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const MAX_IDS_PER_PRICE_REQUEST = 50;
const QUOTE_SLIPPAGE_BPS = 50;
const REQUEST_INTERVAL_MS = 1100;

/** Quotes are display-only estimates; sweep re-quotes anyway. */
export const MAX_QUOTE_TARGETS = 30;

export type QuoteStatus = 'pending' | 'done' | 'skipped';

export interface PricedBalance extends TokenBalance {
  priceAvailable: boolean;
  /** null when Jupiter has no reliable price for the mint. */
  usdValue: number | null;
  /** Raw lamports from the quote endpoint; filled in during phase 2. */
  estimatedSolOut?: string;
  /** Set on dust items once quote targets are chosen. */
  quoteStatus?: QuoteStatus;
}

export interface DustClassification {
  dust: PricedBalance[];
  aboveThreshold: PricedBalance[];
  noMarket: PricedBalance[];
}

export interface PriceOptions {
  fetchImpl?: typeof fetch;
  minRequestIntervalMs?: number;
}

export interface QuoteOptions extends PriceOptions {
  concurrency?: number;
  signal?: AbortSignal;
}

export function tokenUiAmount(balance: TokenBalance): number {
  return Number(balance.amountRaw) / 10 ** balance.decimals;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Spaces request starts at least intervalMs apart, in call order. */
function createThrottle(intervalMs: number) {
  let nextSlot: Promise<void> = Promise.resolve();
  return <T>(task: () => Promise<T>): Promise<T> => {
    const slot = nextSlot;
    nextSlot =
      intervalMs > 0 ? slot.then(() => sleep(intervalMs)) : slot;
    return slot.then(task);
  };
}

// One shared throttle so scan, quotes and the SOL price never overlap.
const sharedThrottle = createThrottle(REQUEST_INTERVAL_MS);

function throttleFor(opts: PriceOptions) {
  return opts.minRequestIntervalMs !== undefined
    ? createThrottle(opts.minRequestIntervalMs)
    : sharedThrottle;
}

/** All Jupiter requests outside this module go through the shared throttle. */
export function jupiterFetch(
  url: string,
  init: RequestInit | undefined,
  opts: PriceOptions = {}
): Promise<Response> {
  const { fetchImpl = fetch } = opts;
  return throttleFor(opts)(() => fetchImpl(url, init));
}

async function mapWithConcurrency<T>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<void>
): Promise<void> {
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(limit, items.length)) },
    async () => {
      while (next < items.length) {
        await fn(items[next++]);
      }
    }
  );
  await Promise.all(workers);
}

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    out.push(items.slice(i, i + size));
  }
  return out;
}

export async function priceTokens(
  balances: TokenBalance[],
  opts: PriceOptions = {}
): Promise<PricedBalance[]> {
  const { fetchImpl = fetch } = opts;
  const throttle = throttleFor(opts);
  const doFetch = (url: string) => throttle(() => fetchImpl(url));

  const mints = [...new Set(balances.map((b) => b.mint))];
  const prices = new Map<string, number>();
  for (const ids of chunk(mints, MAX_IDS_PER_PRICE_REQUEST)) {
    try {
      const res = await doFetch(`${PRICE_URL}?ids=${ids.join(',')}`);
      if (!res.ok) continue;
      const data = await res.json();
      for (const mint of ids) {
        const price = data?.[mint]?.usdPrice;
        if (typeof price === 'number' && Number.isFinite(price)) {
          prices.set(mint, price);
        }
      }
    } catch {
      // whole chunk stays unpriced
    }
  }

  return balances.map((balance) => {
    const price = prices.get(balance.mint);
    if (price === undefined) {
      return { ...balance, priceAvailable: false, usdValue: null };
    }
    return {
      ...balance,
      priceAvailable: true,
      usdValue: tokenUiAmount(balance) * price,
    };
  });
}

export function selectQuoteTargets(
  dust: PricedBalance[],
  max: number = MAX_QUOTE_TARGETS
): PricedBalance[] {
  return dust
    .slice()
    .sort((a, b) => (b.usdValue ?? 0) - (a.usdValue ?? 0))
    .slice(0, max);
}

export async function fetchDustQuotes(
  targets: PricedBalance[],
  opts: QuoteOptions,
  onQuote: (pubkey: string, estimatedSolOut: string | undefined) => void
): Promise<void> {
  const { fetchImpl = fetch, concurrency = 2, signal } = opts;
  const throttle = throttleFor(opts);
  const doFetch = (url: string) => throttle(() => fetchImpl(url));

  await mapWithConcurrency(targets, concurrency, async (item) => {
    if (signal?.aborted) return;
    if (item.mint === SOL_MINT) {
      onQuote(item.pubkey, item.amountRaw);
      return;
    }
    try {
      const url =
        `${QUOTE_URL}?inputMint=${item.mint}&outputMint=${SOL_MINT}` +
        `&amount=${item.amountRaw}&slippageBps=${QUOTE_SLIPPAGE_BPS}`;
      const res = await doFetch(url);
      const quote = res.ok ? await res.json() : null;
      onQuote(
        item.pubkey,
        typeof quote?.outAmount === 'string' ? quote.outAmount : undefined
      );
    } catch {
      onQuote(item.pubkey, undefined);
    }
  });
}

export async function getSolPriceUsd(
  opts: PriceOptions = {}
): Promise<number | null> {
  const { fetchImpl = fetch } = opts;
  const throttle = throttleFor(opts);
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await throttle(() => fetchImpl(`${PRICE_URL}?ids=${SOL_MINT}`));
      if (res.status === 429 && attempt === 0) {
        await sleep(REQUEST_INTERVAL_MS);
        continue;
      }
      if (!res.ok) return null;
      const data = await res.json();
      const price = data?.[SOL_MINT]?.usdPrice;
      return typeof price === 'number' && Number.isFinite(price) ? price : null;
    } catch {
      return null;
    }
  }
  return null;
}

export function classifyDust(
  priced: PricedBalance[],
  thresholdUsd: number = DUST_THRESHOLD_USD
): DustClassification {
  const result: DustClassification = {
    dust: [],
    aboveThreshold: [],
    noMarket: [],
  };
  for (const item of priced) {
    if (!item.priceAvailable || item.usdValue === null) {
      result.noMarket.push(item);
    } else if (item.usdValue < thresholdUsd) {
      result.dust.push(item);
    } else {
      result.aboveThreshold.push(item);
    }
  }
  return result;
}
