import {
  PublicKey,
  SystemInstruction,
  SystemProgram,
  TransactionMessage,
  VersionedTransaction,
} from '@solana/web3.js';
import { PricedBalance } from './price';
import { EmptyAccount } from './scan';
import { buildFeeAndCloses, buildSweepPlan, SweepSelection } from './swap';

const OWNER = PublicKey.unique();
const FEE_WALLET = PublicKey.unique();
const RENT = 2039280;

const PAYER = PublicKey.unique();
const FAKE_TX_B64 = (() => {
  const message = new TransactionMessage({
    payerKey: PAYER,
    recentBlockhash: PublicKey.unique().toBase58(),
    instructions: [
      SystemProgram.transfer({
        fromPubkey: PAYER,
        toPubkey: PAYER,
        lamports: 1,
      }),
    ],
  }).compileToV0Message();
  return Buffer.from(new VersionedTransaction(message).serialize()).toString(
    'base64'
  );
})();

function accounts(n: number, lamports = RENT): EmptyAccount[] {
  return Array.from({ length: n }, () => ({
    pubkey: PublicKey.unique().toBase58(),
    program: 'token' as const,
    lamports,
  }));
}

function dust(mint: string, amountRaw = '1000000'): PricedBalance {
  return {
    pubkey: `acct-${mint}`,
    mint,
    program: 'token',
    amountRaw,
    decimals: 6,
    priceAvailable: true,
    usdValue: 1,
  };
}

function jsonResponse(body: unknown, ok = true): Response {
  return { ok, status: ok ? 200 : 400, json: async () => body } as Response;
}

function jupiterMock(
  outAmounts: Record<string, string>,
  failMints: string[] = []
) {
  return jest.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.endsWith('/quote')) {
      const mint = url.searchParams.get('inputMint')!;
      if (failMints.includes(mint)) return jsonResponse({}, false);
      return jsonResponse({
        inputMint: mint,
        outputMint: url.searchParams.get('outputMint'),
        inAmount: url.searchParams.get('amount'),
        outAmount: outAmounts[mint],
        swapMode: 'ExactIn',
      });
    }
    return jsonResponse({ swapTransaction: FAKE_TX_B64 });
  }) as jest.MockedFunction<typeof fetch>;
}

function selection(over: Partial<SweepSelection> = {}): SweepSelection {
  return {
    owner: OWNER.toBase58(),
    emptyAccounts: [],
    dustTokens: [],
    feeWallet: FEE_WALLET.toBase58(),
    feeBps: 800,
    solPriceUsd: 100,
    ...over,
  };
}

function build(sel: SweepSelection, fetchImpl: typeof fetch) {
  return buildSweepPlan(sel, { fetchImpl, minRequestIntervalMs: 0 });
}

function decodeFeeTransfer(plan: Awaited<ReturnType<typeof buildSweepPlan>>) {
  const last = plan.transactions[plan.transactions.length - 1];
  if (last.kind === 'swap') throw new Error('last tx is a swap');
  const ix = last.transaction.instructions.at(-1)!;
  return SystemInstruction.decodeTransfer(ix);
}

describe('buildSweepPlan', () => {
  it('rent only: fee on rent, appended to the last closes chunk', async () => {
    const fetchImpl = jupiterMock({});
    const plan = await build(
      selection({ emptyAccounts: accounts(25) }),
      fetchImpl
    );

    expect(plan.transactions.map((t) => t.kind)).toEqual([
      'closes',
      'closes',
      'closes',
    ]);
    const rent = 25 * RENT;
    const fee = Math.floor((rent * 800) / 10000);
    expect(plan.summary).toMatchObject({
      accountsClosed: 25,
      tokensSwapped: 0,
      quotedSolOutLamports: 0,
      rentLamports: rent,
      feeLamports: fee,
      userReceivesLamports: rent - fee,
    });

    const closes = plan.transactions.filter((t) => t.kind === 'closes');
    expect(closes.map((c) => c.includesFee)).toEqual([false, false, true]);
    const transfer = decodeFeeTransfer(plan);
    expect(transfer.toPubkey.equals(FEE_WALLET)).toBe(true);
    expect(Number(transfer.lamports)).toBe(fee);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('dust only: fee on aggregate quoted output in a standalone last tx', async () => {
    const fetchImpl = jupiterMock({ mintA: '1000', mintB: '2000' });
    const plan = await build(
      selection({ dustTokens: [dust('mintA'), dust('mintB')] }),
      fetchImpl
    );

    expect(plan.transactions.map((t) => t.kind)).toEqual([
      'swap',
      'swap',
      'fee',
    ]);
    expect(plan.summary).toMatchObject({
      accountsClosed: 0,
      tokensSwapped: 2,
      quotedSolOutLamports: 3000,
      feeLamports: 240,
      userReceivesLamports: 2760,
    });
    const transfer = decodeFeeTransfer(plan);
    expect(transfer.fromPubkey.equals(OWNER)).toBe(true);
    expect(transfer.toPubkey.equals(FEE_WALLET)).toBe(true);
    expect(Number(transfer.lamports)).toBe(240);
  });

  it('mixed: swaps first, one fee on rent + quoted output in the last closes tx', async () => {
    const fetchImpl = jupiterMock({ mintA: '10000' });
    const plan = await build(
      selection({ emptyAccounts: accounts(1), dustTokens: [dust('mintA')] }),
      fetchImpl
    );

    expect(plan.transactions.map((t) => t.kind)).toEqual(['swap', 'closes']);
    const fee = Math.floor(((RENT + 10000) * 800) / 10000);
    expect(plan.summary).toMatchObject({
      accountsClosed: 1,
      tokensSwapped: 1,
      quotedSolOutLamports: 10000,
      rentLamports: RENT,
      feeLamports: fee,
      userReceivesLamports: RENT + 10000 - fee,
    });
    expect(plan.summary.usdEstimate).toBeCloseTo(
      ((RENT + 10000 - fee) / 1e9) * 100
    );
    expect(Number(decodeFeeTransfer(plan).lamports)).toBe(fee);
  });

  it('zero selection: empty plan', async () => {
    const plan = await build(selection(), jupiterMock({}));
    expect(plan.transactions).toEqual([]);
    expect(plan.skippedTokens).toEqual([]);
    expect(plan.summary).toEqual({
      accountsClosed: 0,
      tokensSwapped: 0,
      quotedSolOutLamports: 0,
      rentLamports: 0,
      feeLamports: 0,
      userReceivesLamports: 0,
      usdEstimate: 0,
    });
  });

  it('skips tokens whose quote fails and excludes them from the fee', async () => {
    const fetchImpl = jupiterMock({ mintA: '1000' }, ['mintB']);
    const plan = await build(
      selection({ dustTokens: [dust('mintA'), dust('mintB')] }),
      fetchImpl
    );

    expect(plan.skippedTokens).toEqual([
      { mint: 'mintB', pubkey: 'acct-mintB' },
    ]);
    expect(plan.summary.tokensSwapped).toBe(1);
    expect(plan.summary.quotedSolOutLamports).toBe(1000);
    expect(plan.summary.feeLamports).toBe(80);
  });

  it('requests a fresh quote and swap with the owner as user', async () => {
    const fetchImpl = jupiterMock({ mintA: '1000' });
    await build(selection({ dustTokens: [dust('mintA', '555')] }), fetchImpl);

    const quoteUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(quoteUrl.searchParams.get('inputMint')).toBe('mintA');
    expect(quoteUrl.searchParams.get('amount')).toBe('555');

    const [swapUrl, swapInit] = fetchImpl.mock.calls[1];
    expect(String(swapUrl)).toContain('/swap/v1/swap');
    expect(swapInit?.method).toBe('POST');
    const body = JSON.parse(String(swapInit?.body));
    expect(body.userPublicKey).toBe(OWNER.toBase58());
    expect(body.wrapAndUnwrapSol).toBe(true);
    expect(body.quoteResponse.outAmount).toBe('1000');
  });

  it('fee builder charges only the confirmed swap output it is given', () => {
    const confirmedOnly = buildFeeAndCloses({
      emptyAccounts: [],
      owner: OWNER.toBase58(),
      feeWallet: FEE_WALLET.toBase58(),
      feeBps: 800,
      swapSolOutLamports: 10000, // 1 of 2 quoted swaps confirmed
    });
    expect(confirmedOnly.feeLamports).toBe(800);
    expect(confirmedOnly.transactions.map((t) => t.kind)).toEqual(['fee']);

    const nothingConfirmed = buildFeeAndCloses({
      emptyAccounts: [],
      owner: OWNER.toBase58(),
      feeWallet: FEE_WALLET.toBase58(),
      feeBps: 800,
      swapSolOutLamports: 0,
    });
    expect(nothingConfirmed.feeLamports).toBe(0);
    expect(nothingConfirmed.transactions).toEqual([]); // no fee tx exists at all
  });

  it('fee builder with closes and zero confirmed swaps charges rent fee only', () => {
    const built = buildFeeAndCloses({
      emptyAccounts: accounts(1),
      owner: OWNER.toBase58(),
      feeWallet: FEE_WALLET.toBase58(),
      feeBps: 800,
      swapSolOutLamports: 0,
    });
    expect(built.feeLamports).toBe(Math.floor((RENT * 800) / 10000));
    expect(built.transactions.map((t) => t.kind)).toEqual(['closes']);
    const closes = built.transactions[0];
    expect(closes.kind === 'closes' && closes.includesFee).toBe(true);
    const ix = closes.transaction.instructions.at(-1)!;
    expect(Number(SystemInstruction.decodeTransfer(ix).lamports)).toBe(
      built.feeLamports
    );
  });

  it('deserializes the swap transaction as versioned', async () => {
    const plan = await build(
      selection({ dustTokens: [dust('mintA')] }),
      jupiterMock({ mintA: '1000' })
    );
    const swap = plan.transactions[0];
    expect(swap.kind).toBe('swap');
    expect(swap.transaction).toBeInstanceOf(VersionedTransaction);
  });
});
