import { isAddress } from '@solana/kit';
import { isRecord } from './rpc';

/** mint to USD price. Mints without a reliable price are simply absent. */
export type PriceSource = (mints: readonly string[]) => Promise<ReadonlyMap<string, number>>;

export interface JupiterPriceOptions {
  url: string;
  apiKey?: string | null;
  fetchImpl?: typeof fetch;
  /** Keyless Jupiter allows 0.5 requests per second. */
  minIntervalMs?: number;
  timeoutMs?: number;
  sleep?: (ms: number) => Promise<void>;
}

const MAX_IDS_PER_REQUEST = 50;

const defaultSleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Jupiter Price API v3. One request per 50 mints, spaced to respect the rate
 * limit. A failed chunk leaves its mints unpriced; it never guesses a price.
 */
export function createJupiterPriceSource(options: JupiterPriceOptions): PriceSource {
  const {
    url,
    apiKey = null,
    fetchImpl = fetch,
    minIntervalMs = 2100,
    timeoutMs = 15_000,
    sleep = defaultSleep,
  } = options;
  return async (mints) => {
    const unique = [...new Set(mints)].filter((m) => isAddress(m));
    const prices = new Map<string, number>();
    for (let i = 0; i < unique.length; i += MAX_IDS_PER_REQUEST) {
      if (i > 0 && minIntervalMs > 0) await sleep(minIntervalMs);
      const ids = unique.slice(i, i + MAX_IDS_PER_REQUEST);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await fetchImpl(`${url}?ids=${ids.map(encodeURIComponent).join(',')}`, {
          headers: apiKey ? { 'x-api-key': apiKey } : {},
          signal: controller.signal,
        });
        if (!res.ok) continue;
        const body: unknown = await res.json();
        if (!isRecord(body)) continue;
        for (const mint of ids) {
          const entry = body[mint];
          if (!isRecord(entry)) continue;
          const price = entry.usdPrice;
          if (typeof price === 'number' && Number.isFinite(price) && price >= 0) prices.set(mint, price);
        }
      } catch {
        // chunk stays unpriced
      } finally {
        clearTimeout(timer);
      }
    }
    return prices;
  };
}

/** For tests and for screens that must not call the network. */
export function staticPriceSource(prices: Record<string, number>): PriceSource {
  return async (mints) => {
    const out = new Map<string, number>();
    for (const m of mints) {
      const p = prices[m];
      if (p !== undefined) out.set(m, p);
    }
    return out;
  };
}
