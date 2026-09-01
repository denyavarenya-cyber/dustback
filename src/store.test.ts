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

jest.mock('./core/wallet', () => ({
  connect: jest.fn(),
  signAndSendTransactions: jest.fn(),
}));

jest.mock('./core/swap', () => ({
  ...jest.requireActual('./core/swap'),
  buildSweepPlan: jest.fn(),
}));

jest.mock('./core/sweep', () => ({
  ...jest.requireActual('./core/sweep'),
  waitForSignatureOutcomes: jest.fn(),
}));

jest.mock('@solana/web3.js', () => {
  const actual = jest.requireActual('@solana/web3.js');
  const connectionMock = {
    getLatestBlockhash: jest.fn(),
    getSignatureStatuses: jest.fn(),
    simulateTransaction: jest.fn(),
  };
  return {
    ...actual,
    Connection: jest.fn(() => connectionMock),
    __connectionMock: connectionMock,
  };
});

const connectionMock = (
  jest.requireMock('@solana/web3.js') as {
    __connectionMock: {
      getLatestBlockhash: jest.Mock;
      getSignatureStatuses: jest.Mock;
      simulateTransaction: jest.Mock;
    };
  }
).__connectionMock;

import { Transaction } from '@solana/web3.js';
import {
  fetchDustQuotes,
  getSolPriceUsd,
  PricedBalance,
  priceTokens,
} from './core/price';
import { EmptyAccount, scanWallet, ScanResult } from './core/scan';
import { waitForSignatureOutcomes } from './core/sweep';
import { buildSweepPlan, PlannedTransaction, SweepPlan } from './core/swap';
import { signAndSendTransactions } from './core/wallet';
import { useSweeperStore } from './store';

const mockScanWallet = scanWallet as jest.MockedFunction<typeof scanWallet>;
const mockPriceTokens = priceTokens as jest.MockedFunction<typeof priceTokens>;
const mockGetSolPriceUsd = getSolPriceUsd as jest.MockedFunction<
  typeof getSolPriceUsd
>;
const mockFetchDustQuotes = fetchDustQuotes as jest.MockedFunction<
  typeof fetchDustQuotes
>;
const mockSignAndSend = signAndSendTransactions as jest.MockedFunction<
  typeof signAndSendTransactions
>;
const mockBuildSweepPlan = buildSweepPlan as jest.MockedFunction<
  typeof buildSweepPlan
>;
const mockWaitOutcomes = waitForSignatureOutcomes as jest.MockedFunction<
  typeof waitForSignatureOutcomes
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
    view: 'form',
    address: ADDRESS,
    loading: false,
    error: null,
    results: null,
    scanId: 0,
    quoteProgress: null,
    wallet: null,
    plan: null,
    planning: false,
    executing: false,
    confirming: false,
    sweepError: null,
    outcome: null,
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

const OWNER_B58 = PublicKey.unique().toBase58();
const RENT = 2039280;

function emptyAccount(lamports = RENT): EmptyAccount {
  return { pubkey: PublicKey.unique().toBase58(), program: 'token', lamports };
}

function swapItem(mint: string, quotedSolOut: number): PlannedTransaction {
  return {
    kind: 'swap',
    mint,
    pubkey: `acct-${mint}`,
    amountRaw: '1000',
    decimals: 6,
    quotedSolOut,
    transaction: {} as never,
  };
}

function closesItem(
  accounts: EmptyAccount[],
  includesFee: boolean
): PlannedTransaction {
  return {
    kind: 'closes',
    emptyAccounts: accounts,
    rentLamports: accounts.reduce((s, a) => s + a.lamports, 0),
    includesFee,
    transaction: new Transaction(),
  };
}

function feeItem(): PlannedTransaction {
  return { kind: 'fee', transaction: new Transaction() };
}

function makePlan(transactions: PlannedTransaction[]): SweepPlan {
  const swaps = transactions.filter(
    (t): t is Extract<PlannedTransaction, { kind: 'swap' }> =>
      t.kind === 'swap'
  );
  const closes = transactions.filter(
    (t): t is Extract<PlannedTransaction, { kind: 'closes' }> =>
      t.kind === 'closes'
  );
  const quoted = swaps.reduce((s, t) => s + t.quotedSolOut, 0);
  const rent = closes.reduce((s, t) => s + t.rentLamports, 0);
  const fee = Math.floor(((quoted + rent) * 800) / 10000);
  return {
    transactions,
    skippedTokens: [],
    summary: {
      accountsClosed: closes.reduce((s, t) => s + t.emptyAccounts.length, 0),
      tokensSwapped: swaps.length,
      quotedSolOutLamports: quoted,
      rentLamports: rent,
      feeLamports: fee,
      userReceivesLamports: quoted + rent - fee,
      usdEstimate: null,
    },
  };
}

function seedPlan(plan: SweepPlan) {
  useSweeperStore.setState({
    view: 'review',
    wallet: { address: OWNER_B58, authToken: 'token-1' },
    results: {
      owner: OWNER_B58,
      emptyAccounts: [],
      priced: [],
      solPriceUsd: 100,
    },
    plan,
  });
  connectionMock.getLatestBlockhash.mockResolvedValue({
    blockhash: PublicKey.unique().toBase58(),
    lastValidBlockHeight: 1,
  });
  connectionMock.simulateTransaction.mockResolvedValue({
    value: { err: null, logs: [] },
  });
  mockSignAndSend.mockImplementation(async (_session, txs) => ({
    signatures: txs.map((_, i) => `sig${i}`),
    session: { address: OWNER_B58, authToken: 'token-2' },
  }));
  mockWaitOutcomes.mockImplementation(async (_c, sigs) =>
    sigs.map(() => 'confirmed' as const)
  );
}

describe('confirmSweep', () => {
  it('mixed batch all success: honest outcome and fee accounting', async () => {
    const plan = makePlan([
      swapItem('mintA', 10000),
      closesItem([emptyAccount()], true),
    ]);
    seedPlan(plan);
    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('done');
    expect(state.plan).toBeNull();
    expect(state.wallet?.authToken).toBe('token-2');
    const fee = plan.summary.feeLamports;
    expect(state.outcome).toMatchObject({
      swappedCount: 1,
      totalSwaps: 1,
      closedAccounts: 1,
      totalAccounts: 1,
      recoveredLamports: 10000 + RENT - fee,
      feeTaken: true,
      feeLamports: fee,
    });
    expect(state.outcome!.items.map((i) => i.status)).toEqual([
      'confirmed',
      'confirmed',
    ]);
    expect(state.outcome!.usdEstimate).toBeCloseTo(
      ((10000 + RENT - fee) / 1e9) * 100
    );
  });

  it('one swap fails mid-batch: the rest still count', async () => {
    const plan = makePlan([
      swapItem('mintA', 10000),
      swapItem('mintB', 20000),
      closesItem([emptyAccount()], true),
    ]);
    seedPlan(plan);
    mockWaitOutcomes.mockResolvedValue(['confirmed', 'failed', 'confirmed']);

    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('done');
    const fee = plan.summary.feeLamports;
    expect(state.outcome).toMatchObject({
      swappedCount: 1,
      totalSwaps: 2,
      closedAccounts: 1,
      recoveredLamports: 10000 + RENT - fee,
      feeTaken: true,
    });
    expect(state.outcome!.items.map((i) => i.status)).toEqual([
      'confirmed',
      'failed',
      'confirmed',
    ]);
  });

  it('swap timeout: reported as not swapped', async () => {
    const plan = makePlan([
      swapItem('mintA', 10000),
      closesItem([emptyAccount()], true),
    ]);
    seedPlan(plan);
    mockWaitOutcomes.mockResolvedValue(['timeout', 'confirmed']);

    await useSweeperStore.getState().confirmSweep();

    const outcome = useSweeperStore.getState().outcome!;
    expect(outcome.swappedCount).toBe(0);
    expect(outcome.recoveredLamports).toBe(RENT - plan.summary.feeLamports);
    expect(outcome.items[0].status).toBe('timeout');
  });

  it('closes-only selection', async () => {
    const plan = makePlan([
      closesItem([emptyAccount(), emptyAccount()], true),
    ]);
    seedPlan(plan);

    await useSweeperStore.getState().confirmSweep();

    const outcome = useSweeperStore.getState().outcome!;
    expect(outcome).toMatchObject({
      swappedCount: 0,
      totalSwaps: 0,
      closedAccounts: 2,
      recoveredLamports: 2 * RENT - plan.summary.feeLamports,
      feeTaken: true,
    });
  });

  it('swaps-only: failed standalone fee tx means no fee taken', async () => {
    const plan = makePlan([swapItem('mintA', 10000), feeItem()]);
    seedPlan(plan);
    mockWaitOutcomes.mockResolvedValue(['confirmed', 'failed']);

    await useSweeperStore.getState().confirmSweep();

    const outcome = useSweeperStore.getState().outcome!;
    expect(outcome).toMatchObject({
      swappedCount: 1,
      recoveredLamports: 10000,
      feeTaken: false,
    });
  });

  it('blocks the wallet on simulation failure and stays on review', async () => {
    const plan = makePlan([closesItem([emptyAccount()], true)]);
    seedPlan(plan);
    connectionMock.simulateTransaction.mockResolvedValue({
      value: {
        err: { InsufficientFundsForRent: { account_index: 2 } },
        logs: [],
      },
    });

    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('review');
    expect(state.sweepError).toMatch(/fee wallet not rent-exempt/);
    expect(state.executing).toBe(false);
    expect(mockSignAndSend).not.toHaveBeenCalled();
    expect(state.outcome).toBeNull();
  });

  it('sends transactions to the wallet in plan order', async () => {
    const plan = makePlan([
      swapItem('mintA', 10000),
      closesItem([emptyAccount()], true),
    ]);
    seedPlan(plan);
    await useSweeperStore.getState().confirmSweep();

    const sent = mockSignAndSend.mock.calls[0][1];
    expect(sent).toEqual(plan.transactions.map((t) => t.transaction));
  });
});

describe('startReview', () => {
  it('discards a plan that finishes after leaving review', async () => {
    useSweeperStore.setState({
      view: 'results',
      wallet: { address: OWNER_B58, authToken: 'token-1' },
      results: {
        owner: OWNER_B58,
        emptyAccounts: [],
        priced: [],
        solPriceUsd: 100,
      },
    });
    const building = deferred();
    const plan = makePlan([closesItem([emptyAccount()], true)]);
    mockBuildSweepPlan.mockImplementation(async () => {
      await building.promise;
      return plan;
    });

    const startPromise = useSweeperStore
      .getState()
      .startReview({ emptyAccounts: [], dustTokens: [] });
    expect(useSweeperStore.getState().view).toBe('review');
    expect(useSweeperStore.getState().planning).toBe(true);

    useSweeperStore.getState().cancelReview();
    building.resolve();
    await startPromise;

    const state = useSweeperStore.getState();
    expect(state.view).toBe('results');
    expect(state.plan).toBeNull();
    expect(state.planning).toBe(false);
  });
});
