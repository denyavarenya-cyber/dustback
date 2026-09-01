import {
  classifyDust,
  getSolPriceUsd,
  PricedBalance,
  priceTokens,
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

const OPTS = { thresholdUsd: 5, minRequestIntervalMs: 0 };

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

  it('sets estimatedSolOut only on dust items', async () => {
    const fetchImpl = mockFetch();
    const priced = await priceTokens(
      [DUST_BALANCE, BIG_BALANCE, NO_MARKET_BALANCE],
      { ...OPTS, fetchImpl }
    );

    const byMint = new Map(priced.map((p) => [p.mint, p]));
    expect(byMint.get(DUST_MINT)?.estimatedSolOut).toBe('12345');
    expect(byMint.get(BIG_MINT)).not.toHaveProperty('estimatedSolOut');
    expect(byMint.get(NO_MARKET_MINT)).not.toHaveProperty('estimatedSolOut');
  });

  it('requests quotes only for dust mints, into SOL, for the raw amount', async () => {
    const fetchImpl = mockFetch();
    await priceTokens([DUST_BALANCE, BIG_BALANCE, NO_MARKET_BALANCE], {
      ...OPTS,
      fetchImpl,
    });

    const quoteUrls = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.includes('/quote'));
    expect(quoteUrls).toHaveLength(1);
    expect(quoteUrls[0].searchParams.get('inputMint')).toBe(DUST_MINT);
    expect(quoteUrls[0].searchParams.get('outputMint')).toBe(SOL_MINT);
    expect(quoteUrls[0].searchParams.get('amount')).toBe(
      DUST_BALANCE.amountRaw
    );
  });

  it('batches all mints into one price request', async () => {
    const fetchImpl = mockFetch();
    await priceTokens([DUST_BALANCE, BIG_BALANCE, NO_MARKET_BALANCE], {
      ...OPTS,
      fetchImpl,
    });

    const priceUrls = fetchImpl.mock.calls
      .map(([input]) => new URL(String(input)))
      .filter((url) => url.pathname.startsWith('/price/'));
    expect(priceUrls).toHaveLength(1);
    expect(priceUrls[0].searchParams.get('ids')).toBe(
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

  it('keeps dust classification when the quote request fails', async () => {
    const fetchImpl = mockFetch(() => {
      throw new Error('quote down');
    });
    const priced = await priceTokens([DUST_BALANCE], { ...OPTS, fetchImpl });

    expect(priced[0]).toMatchObject({ priceAvailable: true, usdValue: 2 });
    expect(priced[0]).not.toHaveProperty('estimatedSolOut');
  });

  it('uses the raw balance as estimatedSolOut for wrapped SOL', async () => {
    const fetchImpl = mockFetch();
    const solPrice = { [SOL_MINT]: { usdPrice: 100, decimals: 9 } };
    (fetchImpl as jest.Mock).mockImplementation(async () =>
      jsonResponse(solPrice)
    );

    const wsol = balance(SOL_MINT, '1000000', 9); // 0.001 SOL => $0.10 dust
    const priced = await priceTokens([wsol], { ...OPTS, fetchImpl });

    expect(priced[0].estimatedSolOut).toBe('1000000');
    expect(fetchImpl).toHaveBeenCalledTimes(1); // no quote request
  });
});

describe('classifyDust', () => {
  function priceless(mint: string): PricedBalance {
    return { ...balance(mint, '1'), priceAvailable: false, usdValue: null };
  }
  function pricedAt(mint: string, usdValue: number): PricedBalance {
    return { ...balance(mint, '1'), priceAvailable: true, usdValue };
  }

  it('splits into dust, aboveThreshold and noMarket', () => {
    const dust = pricedAt(DUST_MINT, 2);
    const big = pricedAt(BIG_MINT, 30);
    const dark = priceless(NO_MARKET_MINT);

    expect(classifyDust([dust, big, dark], 5)).toEqual({
      dust: [dust],
      aboveThreshold: [big],
      noMarket: [dark],
    });
  });

  it('treats a value exactly at the threshold as above threshold', () => {
    const item = pricedAt(BIG_MINT, 5);
    expect(classifyDust([item], 5).aboveThreshold).toEqual([item]);
  });
});

describe('getSolPriceUsd', () => {
  it('returns the SOL usd price', async () => {
    const fetchImpl = jest.fn(async () =>
      jsonResponse({ [SOL_MINT]: { usdPrice: 101.5 } })
    ) as unknown as typeof fetch;
    expect(await getSolPriceUsd(fetchImpl)).toBe(101.5);
  });

  it('returns null on failure', async () => {
    const fetchImpl = jest.fn(async () => {
      throw new Error('down');
    }) as unknown as typeof fetch;
    expect(await getSolPriceUsd(fetchImpl)).toBeNull();
  });

  it('retries once when rate limited', async () => {
    const fetchImpl = jest
      .fn()
      .mockResolvedValueOnce({ ok: false, status: 429, json: async () => ({}) })
      .mockResolvedValueOnce(jsonResponse({ [SOL_MINT]: { usdPrice: 99 } }));
    expect(await getSolPriceUsd(fetchImpl as unknown as typeof fetch)).toBe(99);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});

describe('tokenUiAmount', () => {
  it('applies decimals', () => {
    expect(tokenUiAmount(balance('m', '2500000', 6))).toBe(2.5);
  });
});
