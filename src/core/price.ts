import { DUST_THRESHOLD_USD } from '../config';
import { TokenBalance } from './scan';

export const SOL_MINT = 'So11111111111111111111111111111111111111112';

// Jupiter free tier: no API key, shared 1 req/s limit across all endpoints.
const PRICE_URL = 'https://lite-api.jup.ag/price/v3';
const QUOTE_URL = 'https://lite-api.jup.ag/swap/v1/quote';
const MAX_IDS_PER_PRICE_REQUEST = 50;
const QUOTE_SLIPPAGE_BPS = 50;
const REQUEST_INTERVAL_MS = 1100;

export interface PricedBalance extends TokenBalance {
  priceAvailable: boolean;
  /** null when Jupiter has no reliable price for the mint. */
  usdValue: number | null;
  /** Raw lamports from the quote endpoint; set only on dust items. */
  estimatedSolOut?: string;
}

export interface DustClassification {
  dust: PricedBalance[];
  aboveThreshold: PricedBalance[];
  noMarket: PricedBalance[];
}

export interface PriceOptions {
  thresholdUsd?: number;
  fetchImpl?: typeof fetch;
  minRequestIntervalMs?: number;
  concurrency?: number;
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

async function fetchUsdPrices(
  mints: string[],
  doFetch: (url: string) => Promise<Response>
): Promise<Map<string, number>> {
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
  return prices;
}

async function fetchEstimatedSolOut(
  item: PricedBalance,
  doFetch: (url: string) => Promise<Response>
): Promise<void> {
  if (item.mint === SOL_MINT) {
    item.estimatedSolOut = item.amountRaw;
    return;
  }
  try {
    const url =
      `${QUOTE_URL}?inputMint=${item.mint}&outputMint=${SOL_MINT}` +
      `&amount=${item.amountRaw}&slippageBps=${QUOTE_SLIPPAGE_BPS}`;
    const res = await doFetch(url);
    if (!res.ok) return;
    const quote = await res.json();
    if (typeof quote?.outAmount === 'string') {
      item.estimatedSolOut = quote.outAmount;
    }
  } catch {
    // display-only estimate; leave unset
  }
}

export async function priceTokens(
  balances: TokenBalance[],
  opts: PriceOptions = {}
): Promise<PricedBalance[]> {
  const {
    thresholdUsd = DUST_THRESHOLD_USD,
    fetchImpl = fetch,
    minRequestIntervalMs = REQUEST_INTERVAL_MS,
    concurrency = 2,
  } = opts;
  const throttle = createThrottle(minRequestIntervalMs);
  const doFetch = (url: string) => throttle(() => fetchImpl(url));

  const mints = [...new Set(balances.map((b) => b.mint))];
  const prices = await fetchUsdPrices(mints, doFetch);

  const priced: PricedBalance[] = balances.map((balance) => {
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

  const dust = priced.filter(
    (p) => p.priceAvailable && (p.usdValue as number) < thresholdUsd
  );
  await mapWithConcurrency(dust, concurrency, (item) =>
    fetchEstimatedSolOut(item, doFetch)
  );

  return priced;
}

export async function getSolPriceUsd(
  fetchImpl: typeof fetch = fetch
): Promise<number | null> {
  try {
    const res = await fetchImpl(`${PRICE_URL}?ids=${SOL_MINT}`);
    if (!res.ok) return null;
    const data = await res.json();
    const price = data?.[SOL_MINT]?.usdPrice;
    return typeof price === 'number' && Number.isFinite(price) ? price : null;
  } catch {
    return null;
  }
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
