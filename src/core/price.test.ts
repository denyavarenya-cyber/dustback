import {
  classifyDust,
  fetchDustQuotes,
  getSolPriceUsd,
  MAX_QUOTE_TARGETS,
  PricedBalance,
  priceTokens,
  selectQuoteTargets,
  SOL_MINT,
  tokenUiAmount,
} from './price';
import { TokenBalance } from './scan';

const DUST_MINT = 'DustMint111111111111111111111111111111111111';
const BIG_MINT = 'BigMint1111111111111111111111111111111111111';
const NO_MARKET_MINT = 'NoMarket111111111111111111111111111111111111';

function balance(mint: string, amountRaw: string, decimals = 6): TokenBalance {
  return { pubkey: `acct-${mint}`, mint, program: 'token', amountRaw, decimals };
}

// 2 tokens at $1 => $2 (dust), 10 tokens at $3 => $30 (above threshold)
const DUST_BALANCE = balance(DUST_MINT, '2000000');
const BIG_BALANCE = balance(BIG_MINT, '10000000');
const NO_MARKET_BALANCE = balance(NO_MARKET_MINT, '5000000');

const PRICE_RESPONSE: Record<string, { usdPrice: number; decimals: number }> = {
  [DUST_MINT]: { usdPrice: 1, decimals: 6 },
  [BIG_MINT]: { usdPrice: 3, decimals: 6 },
};

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
  } as Response;
}

function mockFetch(
  onQuote: (url: URL) => Response | Promise<Response> = () =>
    jsonResponse({ outAmount: '12345' })
) {
  return jest.fn(async (input: RequestInfo | URL) => {
    const url = new URL(String(input));
    if (url.pathname.startsWith('/price/')) {
      return jsonResponse(PRICE_RESPONSE);
    }
    return onQuote(url);
  }) as unknown as jest.MockedFunction<typeof fetch>;
}

function pricedDust(
  mint: string,
  usdValue: number,
  amountRaw = '2000000'
): PricedBalance {
  return { ...balance(mint, amountRaw), priceAvailable: true, usdValue };
}

const OPTS = { minRequestIntervalMs: 0 };

describe('priceTokens', () => {
  it('enriches balances with usd value and price availability', async () => {
    const fetchImpl = mockFetch();
    const priced = await priceTokens(
      [DUST_BALANCE, BIG_BALANCE, NO_MARKET_BALANCE],
      { ...OPTS, fetchImpl }
    );

    const byMint = new Map(priced.map((p) => [p.mint, p]));
    expect(byMint.get(DUST_MINT)).toMatchObject({
      priceAvailable: true,
      usdValue: 2,
    });
    expect(byMint.get(BIG_MINT)).toMatchObject({
      priceAvailable: true,
      usdValue: 30,
    });
    expect(byMint.get(NO_MARKET_MINT)).toMatchObject({
      priceAvailable: false,
      usdValue: null,
    });
  });

  it('never fetches quotes and sets no estimatedSolOut', async () => {
    const fetchImpl = mockFetch();
    const priced = await priceTokens([DUST_BALANCE, BIG_BALANCE], {
      ...OPTS,
      fetchImpl,
    });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    for (const item of priced) {
      expect(item).not.toHaveProperty('estimatedSolOut');
      expect(item).not.toHaveProperty('quoteStatus');
    }
  });

  it('batches all mints into one price request', async () => {
    const fetchImpl = mockFetch();
    await priceTokens([DUST_BALANCE, BIG_BALANCE, NO_MARKET_BALANCE], {
      ...OPTS,
      fetchImpl,
    });

    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname.startsWith('/price/')).toBe(true);
    expect(url.searchParams.get('ids')).toBe(
      [DUST_MINT, BIG_MINT, NO_MARKET_MINT].join(',')
    );
  });

  it('marks every balance unpriced when the price request fails', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('network down');
    }) as unknown as typeof fetch;

    const priced = await priceTokens([DUST_BALANCE, BIG_BALANCE], {
      ...OPTS,
      fetchImpl,
    });
    expect(priced).toHaveLength(2);
    for (const item of priced) {
      expect(item.priceAvailable).toBe(false);
      expect(item.usdValue).toBeNull();
    }
  });
});

describe('selectQuoteTargets', () => {
  it('sorts by usd value descending and caps at max', () => {
    const dust = [
      pricedDust('m1', 1),
      pricedDust('m2', 4),
      pricedDust('m3', 2),
    ];
    const targets = selectQuoteTargets(dust, 2);
    expect(targets.map((t) => t.mint)).toEqual(['m2', 'm3']);
  });

  it('defaults to MAX_QUOTE_TARGETS', () => {
    const dust = Array.from({ length: MAX_QUOTE_TARGETS + 5 }, (_, i) =>
      pricedDust(`mint${i}`, i / 100)
    );
    expect(selectQuoteTargets(dust)).toHaveLength(MAX_QUOTE_TARGETS);
  });
});

describe('fetchDustQuotes', () => {
  it('quotes each target into SOL for the raw amount', async () => {
    const fetchImpl = mockFetch();
    const seen: Array<[string, string | undefined]> = [];
    await fetchDustQuotes(
      [pricedDust(DUST_MINT, 2)],
      { ...OPTS, fetchImpl },
      (pubkey, out) => seen.push([pubkey, out])
    );

    expect(seen).toEqual([[`acct-${DUST_MINT}`, '12345']]);
    const url = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(url.pathname.includes('/quote')).toBe(true);
    expect(url.searchParams.get('inputMint')).toBe(DUST_MINT);
    expect(url.searchParams.get('outputMint')).toBe(SOL_MINT);
    expect(url.searchParams.get('amount')).toBe('2000000');
  });

  it('reports undefined when the quote request fails', async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error('quote down');
    });
    const seen: Array<[string, string | undefined]> = [];
    await fetchDustQuotes(
      [pricedDust(DUST_MINT, 2)],
      { ...OPTS, fetchImpl },
      (pubkey, out) => seen.push([pubkey, out])
    );
    expect(seen).toEqual([[`acct-${DUST_MINT}`, undefined]]);
  });

  it('uses the raw balance for wrapped SOL without a request', async () => {
    const fetchImpl = mockFetch();
    const seen: Array<[string, string | undefined]> = [];
    await fetchDustQuotes(
      [pricedDust(SOL_MINT, 0.1, '1000000')],
      { ...OPTS, fetchImpl },
      (pubkey, out) => seen.push([pubkey, out])
    );
    expect(seen).toEqual([[`acct-${SOL_MINT}`, '1000000']]);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('stops issuing requests once aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const fetchImpl = mockFetch();
    const seen: string[] = [];
    await fetchDustQuotes(
      [pricedDust('m1', 1), pricedDust('m2', 2)],
      { ...OPTS, fetchImpl, signal: abort.signal },
      (pubkey) => seen.push(pubkey)
    );
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(seen).toEqual([]);
  });
});

describe('classifyDust', () => {
  function priceless(mint: string): PricedBalance {
    return { ...balance(mint, '1'), priceAvailable: false, usdValue: null };
  }

  it('splits into dust, aboveThreshold and noMarket', () => {
    const dust = pricedDust(DUST_MINT, 2);
    const big = pricedDust(BIG_MINT, 30);
    const dark = priceless(NO_MARKET_MINT);

    expect(classifyDust([dust, big, dark], 5)).toEqual({
      dust: [dust],
      aboveThreshold: [big],
      noMarket: [dark],
    });
  });

  it('treats a value exactly at the threshold as above threshold', () => {
    const item = pricedDust(BIG_MINT, 5);
    expect(classifyDust([item], 5).aboveThreshold).toEqual([item]);
  });
});

describe('getSolPriceUsd', () => {
  it('returns the SOL usd price', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ [SOL_MINT]: { usdPrice: 101.5 } })
    ) as unknown as typeof fetch;
    expect(await getSolPriceUsd({ ...OPTS, fetchImpl })).toBe(101.5);
  });

  it('returns null on failure', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await getSolPriceUsd({ ...OPTS, fetchImpl })).toBeNull();
  });

  it('retries once when rate limited', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(jsonResponse({ [SOL_MINT]: { usdPrice: 99 } }));
    expect(
      await getSolPriceUsd({ ...OPTS, fetchImpl: fetchImpl as unknown as typeof fetch })
    ).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('tokenUiAmount', () => {
  it('applies decimals', () => {
    expect(tokenUiAmount(balance('m', '2500000', 6))).toBe(2.5);
  });
});
