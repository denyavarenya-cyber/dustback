import { PublicKey } from '@solana/web3.js';

jest.mock('@react-native-async-storage/async-storage', () => ({
  __esModule: true,
  default: {
    getItem: jest.fn(async () => null),
    setItem: jest.fn(async () => {}),
  },
}));

jest.mock('./core/scan', () => ({
  ...jest.requireActual('./core/scan'),
  scanWallet: jest.fn(),
}));

jest.mock('./core/price', () => ({
  ...jest.requireActual('./core/price'),
  priceTokens: jest.fn(),
  getSolPriceUsd: jest.fn(),
  fetchDustQuotes: jest.fn(),
}));

import {
  fetchDustQuotes,
  getSolPriceUsd,
  PricedBalance,
  priceTokens,
} from './core/price';
import { scanWallet, ScanResult } from './core/scan';
import { useSweeperStore } from './store';

const mockScanWallet = scanWallet as jest.MockedFunction<typeof scanWallet>;
const mockPriceTokens = priceTokens as jest.MockedFunction<typeof priceTokens>;
const mockGetSolPriceUsd = getSolPriceUsd as jest.MockedFunction<
  typeof getSolPriceUsd
>;
const mockFetchDustQuotes = fetchDustQuotes as jest.MockedFunction<
  typeof fetchDustQuotes
>;

const ADDRESS = PublicKey.unique().toBase58();

function pricedDust(pubkey: string, usdValue: number): PricedBalance {
  return {
    pubkey,
    mint: `mint-${pubkey}`,
    program: 'token',
    amountRaw: '1000',
    decimals: 6,
    priceAvailable: true,
    usdValue,
  };
}

const SCAN_RESULT: ScanResult = {
  emptyAccounts: [{ pubkey: 'empty1', program: 'token', lamports: 2039280 }],
  nonEmptyAccounts: [],
};

type OnQuote = (pubkey: string, estimatedSolOut: string | undefined) => void;

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((r) => (resolve = r));
  return { promise, resolve };
}

function flush(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

async function waitFor(cond: () => boolean): Promise<void> {
  for (let i = 0; i < 50; i++) {
    if (cond()) return;
    await flush();
  }
  throw new Error('condition never became true');
}

beforeEach(() => {
  jest.clearAllMocks();
  useSweeperStore.setState({
    address: ADDRESS,
    loading: false,
    error: null,
    results: null,
    scanId: 0,
    quoteProgress: null,
  });
  mockScanWallet.mockResolvedValue(SCAN_RESULT);
  mockGetSolPriceUsd.mockResolvedValue(100);
});

describe('scan pipeline', () => {
  it('renders phase 1 results before quotes and fills them in after', async () => {
    mockPriceTokens.mockResolvedValue([
      pricedDust('d1', 2),
      { ...pricedDust('big', 30) },
    ]);
    let onQuote: OnQuote | undefined;
    const quotes = deferred();
    mockFetchDustQuotes.mockImplementation(async (_targets, _opts, cb) => {
      onQuote = cb;
      await quotes.promise;
    });

    const scanPromise = useSweeperStore.getState().scan();
    await waitFor(() => useSweeperStore.getState().results !== null);

    let state = useSweeperStore.getState();
    expect(state.loading).toBe(false);
    expect(state.quoteProgress).toEqual({ done: 0, total: 1 });
    const byKey = new Map(state.results!.priced.map((p) => [p.pubkey, p]));
    expect(byKey.get('d1')).toMatchObject({ quoteStatus: 'pending' });
    expect(byKey.get('d1')).not.toHaveProperty('estimatedSolOut');
    expect(byKey.get('big')).not.toHaveProperty('quoteStatus');

    onQuote!('d1', '5000');
    state = useSweeperStore.getState();
    const d1 = state.results!.priced.find((p) => p.pubkey === 'd1')!;
    expect(d1.quoteStatus).toBe('done');
    expect(d1.estimatedSolOut).toBe('5000');
    expect(d1.usdValue).toBe(2); // totals never move when quotes arrive
    expect(state.quoteProgress).toEqual({ done: 1, total: 1 });

    quotes.resolve();
    await scanPromise;
  });

  it('marks dust beyond the quote cap as skipped', async () => {
    const many = Array.from({ length: 31 }, (_, i) =>
      pricedDust(`d${i}`, (i + 1) / 100)
    );
    mockPriceTokens.mockResolvedValue(many);
    mockFetchDustQuotes.mockResolvedValue(undefined);

    await useSweeperStore.getState().scan();

    const state = useSweeperStore.getState();
    const statuses = state.results!.priced.map((p) => p.quoteStatus);
    expect(statuses.filter((s) => s === 'pending')).toHaveLength(30);
    expect(statuses.filter((s) => s === 'skipped')).toHaveLength(1);
    // the lowest-value item is the one skipped
    expect(
      state.results!.priced.find((p) => p.pubkey === 'd0')!.quoteStatus
    ).toBe('skipped');
    expect(state.quoteProgress).toEqual({ done: 0, total: 30 });
  });

  it('ignores late quotes from a superseded scan', async () => {
    mockPriceTokens.mockResolvedValue([pricedDust('old', 1)]);
    let oldOnQuote: OnQuote | undefined;
    const oldQuotes = deferred();
    mockFetchDustQuotes.mockImplementation(async (_t, _o, cb) => {
      oldOnQuote = cb;
      await oldQuotes.promise;
    });

    const first = useSweeperStore.getState().scan();
    await waitFor(() => useSweeperStore.getState().results !== null);

    mockPriceTokens.mockResolvedValue([pricedDust('new', 1)]);
    mockFetchDustQuotes.mockResolvedValue(undefined);
    await useSweeperStore.getState().scan();

    oldOnQuote!('old', '9999');
    const state = useSweeperStore.getState();
    expect(state.results!.priced.map((p) => p.pubkey)).toEqual(['new']);
    expect(state.quoteProgress).toEqual({ done: 0, total: 1 });

    oldQuotes.resolve();
    await first;
  });

  it('ignores late quotes after leaving the results screen', async () => {
    mockPriceTokens.mockResolvedValue([pricedDust('d1', 1)]);
    let onQuote: OnQuote | undefined;
    const quotes = deferred();
    mockFetchDustQuotes.mockImplementation(async (_t, opts, cb) => {
      onQuote = cb;
      await quotes.promise;
      expect(opts.signal?.aborted).toBe(true);
    });

    const scanPromise = useSweeperStore.getState().scan();
    await waitFor(() => useSweeperStore.getState().results !== null);

    useSweeperStore.getState().reset();
    expect(() => onQuote!('d1', '5000')).not.toThrow();
    expect(useSweeperStore.getState().results).toBeNull();
    expect(useSweeperStore.getState().quoteProgress).toBeNull();

    quotes.resolve();
    await scanPromise;
  });
});
