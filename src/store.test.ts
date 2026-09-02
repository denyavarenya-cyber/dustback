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

jest.mock('./core/tokens', () => ({
  fetchTokenSymbols: jest.fn(async () => ({})),
}));

jest.mock('./core/swap', () => ({
  ...jest.requireActual('./core/swap'),
  buildSweepPlan: jest.fn(),
  buildSwapTransactions: jest.fn(),
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

import { SystemInstruction, Transaction } from '@solana/web3.js';
import {
  fetchDustQuotes,
  getSolPriceUsd,
  PricedBalance,
  priceTokens,
} from './core/price';
import { EmptyAccount, scanWallet, ScanResult } from './core/scan';
import { waitForSignatureOutcomes } from './core/sweep';
import {
  buildSwapTransactions,
  buildSweepPlan,
  PlannedTransaction,
  SweepPlan,
} from './core/swap';
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
const mockBuildSwapTx = buildSwapTransactions as jest.MockedFunction<
  typeof buildSwapTransactions
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

// quoted output per mint that the mocked swap rebuild reports
const QUOTED: Record<string, number> = { mintA: 10000, mintB: 20000 };

function seedPlan(plan: SweepPlan) {
  useSweeperStore.setState({
    view: 'review',
    wallet: { address: OWNER_B58, authToken: 'token-1' },
    results: {
      owner: OWNER_B58,
      emptyAccounts: [],
      priced: [],
      solPriceUsd: 100,
      symbols: {},
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
  mockBuildSwapTx.mockImplementation(async (tokens) => ({
    swaps: tokens.map((t) => ({
      ...t,
      quotedSolOut: QUOTED[t.mint] ?? 0,
      transaction: {} as never,
    })),
    skipped: [],
  }));
  let sendCall = 0;
  mockSignAndSend.mockImplementation(async (_session, txs) => {
    sendCall++;
    return {
      signatures: txs.map((_, i) => `sig${sendCall}-${i}`),
      session: { address: OWNER_B58, authToken: `token-${sendCall + 1}` },
    };
  });
  mockWaitOutcomes.mockImplementation(async (_c, sigs) =>
    sigs.map(() => 'confirmed' as const)
  );
}

function decodeLastTransfer(txs: unknown[]) {
  const tx = txs[txs.length - 1] as Transaction;
  const ix = tx.instructions.at(-1)!;
  return SystemInstruction.decodeTransfer(ix);
}

describe('confirmSweep', () => {
  const RENT_FEE = Math.floor((RENT * 800) / 10000);

  it('observed bug: dust-only sweep where the swap never lands takes NO fee', async () => {
    seedPlan(makePlan([swapItem('mintA', 10000), feeItem()]));
    mockWaitOutcomes.mockResolvedValueOnce(['timeout']);

    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('done');
    // one signing session, no fee transaction ever built or sent
    expect(mockSignAndSend).toHaveBeenCalledTimes(1);
    expect(state.outcome).toMatchObject({
      swappedCount: 0,
      totalSwaps: 1,
      recoveredLamports: 0,
      feeLamports: 0,
      feeTaken: false,
      feePhaseError: null,
    });
    expect(state.outcome!.items).toHaveLength(1);
    expect(state.outcome!.items[0]).toMatchObject({
      kind: 'swap',
      status: 'timeout',
    });
  });

  it('mixed sweep: swaps fail, closes succeed, fee covers rent only', async () => {
    seedPlan(
      makePlan([swapItem('mintA', 10000), closesItem([emptyAccount()], true)])
    );
    mockWaitOutcomes
      .mockResolvedValueOnce(['failed'])
      .mockResolvedValueOnce(['confirmed']);

    await useSweeperStore.getState().confirmSweep();

    expect(mockSignAndSend).toHaveBeenCalledTimes(2);
    const transfer = decodeLastTransfer(mockSignAndSend.mock.calls[1][1]);
    expect(Number(transfer.lamports)).toBe(RENT_FEE);

    const outcome = useSweeperStore.getState().outcome!;
    expect(outcome).toMatchObject({
      swappedCount: 0,
      totalSwaps: 1,
      closedAccounts: 1,
      recoveredLamports: RENT - RENT_FEE,
      feeLamports: RENT_FEE,
      feeTaken: true,
    });
  });

  it('partial swaps: fee covers only the confirmed swap output', async () => {
    seedPlan(
      makePlan([swapItem('mintA', 10000), swapItem('mintB', 20000), feeItem()])
    );
    mockWaitOutcomes
      .mockResolvedValueOnce(['confirmed', 'failed'])
      .mockResolvedValueOnce(['confirmed']);

    await useSweeperStore.getState().confirmSweep();

    const fee = Math.floor((10000 * 800) / 10000);
    const transfer = decodeLastTransfer(mockSignAndSend.mock.calls[1][1]);
    expect(Number(transfer.lamports)).toBe(fee);

    const outcome = useSweeperStore.getState().outcome!;
    expect(outcome).toMatchObject({
      swappedCount: 1,
      totalSwaps: 2,
      recoveredLamports: 10000 - fee,
      feeLamports: fee,
      feeTaken: true,
    });
  });

  it('mixed all success: fee on rent + confirmed swaps, phases in order', async () => {
    seedPlan(
      makePlan([swapItem('mintA', 10000), closesItem([emptyAccount()], true)])
    );

    await useSweeperStore.getState().confirmSweep();

    const fee = Math.floor(((10000 + RENT) * 800) / 10000);
    expect(mockSignAndSend).toHaveBeenCalledTimes(2);
    expect(mockSignAndSend.mock.calls[0][1]).toHaveLength(1); // swaps first
    expect(Number(decodeLastTransfer(mockSignAndSend.mock.calls[1][1]).lamports)).toBe(fee);

    const state = useSweeperStore.getState();
    expect(state.wallet?.authToken).toBe('token-3'); // session from 2nd sign
    expect(state.outcome).toMatchObject({
      swappedCount: 1,
      closedAccounts: 1,
      recoveredLamports: 10000 + RENT - fee,
      feeLamports: fee,
      feeTaken: true,
    });
    expect(state.outcome!.usdEstimate).toBeCloseTo(
      ((10000 + RENT - fee) / 1e9) * 100
    );
  });

  it('closes-only: single signing session with rent fee', async () => {
    seedPlan(makePlan([closesItem([emptyAccount(), emptyAccount()], true)]));

    await useSweeperStore.getState().confirmSweep();

    expect(mockBuildSwapTx).not.toHaveBeenCalled();
    expect(mockSignAndSend).toHaveBeenCalledTimes(1);
    const outcome = useSweeperStore.getState().outcome!;
    expect(outcome).toMatchObject({
      swappedCount: 0,
      closedAccounts: 2,
      recoveredLamports: 2 * RENT - Math.floor((2 * RENT * 800) / 10000),
      feeTaken: true,
    });
  });

  it('declined fee phase after confirmed swaps still reports honestly', async () => {
    seedPlan(
      makePlan([swapItem('mintA', 10000), closesItem([emptyAccount()], true)])
    );
    mockSignAndSend
      .mockImplementationOnce(async (_s, txs) => ({
        signatures: txs.map((_, i) => `p1-${i}`),
        session: { address: OWNER_B58, authToken: 'token-2' },
      }))
      .mockRejectedValueOnce(
        Object.assign(new Error('Request declined in wallet'), {
          name: 'WalletSignError',
        })
      );

    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('done');
    const outcome = state.outcome!;
    expect(outcome.swappedCount).toBe(1);
    expect(outcome.closedAccounts).toBe(0);
    expect(outcome.feeTaken).toBe(false);
    expect(outcome.feePhaseError).toMatch(/declined/);
    expect(outcome.recoveredLamports).toBe(10000);
  });

  it('swap preflight failure blocks the wallet and stays on review', async () => {
    seedPlan(makePlan([swapItem('mintA', 10000), feeItem()]));
    connectionMock.simulateTransaction.mockResolvedValue({
      value: { err: 'BlockhashNotFound', logs: [] },
    });

    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('review');
    expect(state.sweepError).toContain('BlockhashNotFound');
    expect(mockSignAndSend).not.toHaveBeenCalled();
    expect(state.outcome).toBeNull();
  });

  it('reset during a hung confirmation never resurrects the done screen', async () => {
    seedPlan(makePlan([swapItem('mintA', 10000), feeItem()]));
    const confirmations = deferred();
    mockWaitOutcomes.mockImplementation(async () => {
      await confirmations.promise;
      return ['confirmed'];
    });

    const sweepPromise = useSweeperStore.getState().confirmSweep();
    await waitFor(() => useSweeperStore.getState().confirming);

    useSweeperStore.getState().reset();
    confirmations.resolve();
    await sweepPromise;

    const state = useSweeperStore.getState();
    expect(state.view).toBe('form');
    expect(state.outcome).toBeNull();
    expect(state.confirming).toBe(false);
    expect(state.executing).toBe(false);
  });

  it('a new scan clears any previous outcome and plan', async () => {
    useSweeperStore.setState({
      outcome: {
        items: [],
        swappedCount: 0,
        totalSwaps: 0,
        closedAccounts: 0,
        totalAccounts: 0,
        recoveredLamports: 0,
        feeLamports: 0,
        feeTaken: false,
        feePhaseError: null,
        usdEstimate: null,
      },
      plan: makePlan([]),
    });
    mockPriceTokens.mockResolvedValue([]);
    mockFetchDustQuotes.mockResolvedValue(undefined);

    await useSweeperStore.getState().scan();

    expect(useSweeperStore.getState().outcome).toBeNull();
    expect(useSweeperStore.getState().plan).toBeNull();
  });

  it('rent-only preflight failure stays on review with a readable error', async () => {
    seedPlan(makePlan([closesItem([emptyAccount()], true)]));
    connectionMock.simulateTransaction.mockResolvedValue({
      value: {
        err: { InsufficientFundsForRent: { account_index: 2 } },
        logs: [],
      },
    });

    await useSweeperStore.getState().confirmSweep();

    const state = useSweeperStore.getState();
    expect(state.view).toBe('review');
    expect(state.sweepError).toMatch(/not rent-exempt/);
    expect(mockSignAndSend).not.toHaveBeenCalled();
    expect(state.outcome).toBeNull();
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
        symbols: {},
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
