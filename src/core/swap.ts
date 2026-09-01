import {
  PublicKey,
  SystemProgram,
  Transaction,
  VersionedTransaction,
} from '@solana/web3.js';
import {
  jupiterFetch,
  PriceOptions,
  PricedBalance,
  QUOTE_URL,
  SOL_MINT,
} from './price';
import { EmptyAccount } from './scan';
import { buildCloseChunks } from './sweep';

const SWAP_URL = 'https://lite-api.jup.ag/swap/v1/swap';
const SWAP_SLIPPAGE_BPS = 100;

export interface SweepSelection {
  owner: string;
  emptyAccounts: EmptyAccount[];
  dustTokens: PricedBalance[];
  feeWallet: string | null;
  feeBps: number;
  solPriceUsd: number | null;
}

export type PlannedTransaction =
  | {
      kind: 'swap';
      mint: string;
      pubkey: string;
      amountRaw: string;
      decimals: number;
      quotedSolOut: number;
      transaction: VersionedTransaction;
    }
  | {
      kind: 'closes';
      emptyAccounts: EmptyAccount[];
      rentLamports: number;
      includesFee: boolean;
      transaction: Transaction;
    }
  | { kind: 'fee'; transaction: Transaction };

export interface SweepPlanSummary {
  accountsClosed: number;
  tokensSwapped: number;
  quotedSolOutLamports: number;
  rentLamports: number;
  feeLamports: number;
  userReceivesLamports: number;
  usdEstimate: number | null;
}

export interface SkippedToken {
  mint: string;
  pubkey: string;
}

export interface SweepPlan {
  transactions: PlannedTransaction[];
  summary: SweepPlanSummary;
  skippedTokens: SkippedToken[];
}

export interface SwapTokenInput {
  mint: string;
  pubkey: string;
  amountRaw: string;
  decimals: number;
}

export interface BuiltSwap extends SwapTokenInput {
  quotedSolOut: number;
  transaction: VersionedTransaction;
}

export type FeeCloseTransaction = Extract<
  PlannedTransaction,
  { kind: 'closes' | 'fee' }
>;

async function buildSwapTransaction(
  token: SwapTokenInput,
  owner: string,
  opts: PriceOptions
): Promise<{ quotedSolOut: number; transaction: VersionedTransaction } | null> {
  try {
    const quoteUrl =
      `${QUOTE_URL}?inputMint=${token.mint}&outputMint=${SOL_MINT}` +
      `&amount=${token.amountRaw}&slippageBps=${SWAP_SLIPPAGE_BPS}`;
    const quoteRes = await jupiterFetch(quoteUrl, undefined, opts);
    if (!quoteRes.ok) return null;
    const quote = await quoteRes.json();
    if (typeof quote?.outAmount !== 'string') return null;

    const swapRes = await jupiterFetch(
      SWAP_URL,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          quoteResponse: quote,
          userPublicKey: owner,
          // unwrap: output lands as native SOL on the owner, not a wSOL account
          wrapAndUnwrapSol: true,
        }),
      },
      opts
    );
    if (!swapRes.ok) return null;
    const swap = await swapRes.json();
    if (typeof swap?.swapTransaction !== 'string') return null;

    return {
      quotedSolOut: Number(quote.outAmount),
      transaction: VersionedTransaction.deserialize(
        Buffer.from(swap.swapTransaction, 'base64')
      ),
    };
  } catch {
    return null;
  }
}

/** Swap txs embed a blockhash that dies in under a minute: build these
 *  immediately before signing, never ahead of a screen the user reads. */
export async function buildSwapTransactions(
  tokens: SwapTokenInput[],
  owner: string,
  opts: PriceOptions = {}
): Promise<{ swaps: BuiltSwap[]; skipped: SkippedToken[] }> {
  const swaps: BuiltSwap[] = [];
  const skipped: SkippedToken[] = [];
  for (const token of tokens) {
    const built = await buildSwapTransaction(token, owner, opts);
    if (built === null) {
      skipped.push({ mint: token.mint, pubkey: token.pubkey });
      continue;
    }
    swaps.push({
      mint: token.mint,
      pubkey: token.pubkey,
      amountRaw: token.amountRaw,
      decimals: token.decimals,
      quotedSolOut: built.quotedSolOut,
      transaction: built.transaction,
    });
  }
  return { swaps, skipped };
}

/** Fee is 8% of rent + swapSolOutLamports. Callers must pass only the
 *  CONFIRMED swap output at send time; a zero basis yields no fee transfer. */
export function buildFeeAndCloses(args: {
  emptyAccounts: EmptyAccount[];
  owner: string;
  feeWallet: string | null;
  feeBps: number;
  swapSolOutLamports: number;
}): {
  transactions: FeeCloseTransaction[];
  rentLamports: number;
  feeLamports: number;
} {
  const owner = new PublicKey(args.owner);
  const rentLamports = args.emptyAccounts.reduce(
    (sum, account) => sum + account.lamports,
    0
  );
  const feeLamports = Math.floor(
    ((rentLamports + args.swapSolOutLamports) * args.feeBps) / 10000
  );
  const feeWallet = args.feeWallet ? new PublicKey(args.feeWallet) : owner;
  const feeInstruction =
    feeLamports > 0
      ? SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: feeWallet,
          lamports: feeLamports,
        })
      : null;

  const transactions: FeeCloseTransaction[] = [];
  const closeChunks = buildCloseChunks(args.emptyAccounts, owner);
  closeChunks.forEach(({ transaction, accounts }, i) => {
    const includesFee =
      i === closeChunks.length - 1 && feeInstruction !== null;
    if (includesFee) transaction.add(feeInstruction!);
    transactions.push({
      kind: 'closes',
      emptyAccounts: accounts,
      rentLamports: accounts.reduce((sum, a) => sum + a.lamports, 0),
      includesFee,
      transaction,
    });
  });
  if (closeChunks.length === 0 && feeInstruction !== null) {
    const tx = new Transaction();
    tx.feePayer = owner;
    tx.add(feeInstruction);
    transactions.push({ kind: 'fee', transaction: tx });
  }
  return { transactions, rentLamports, feeLamports };
}

/** Review-time preview. Quotes here are for DISPLAY; the send path rebuilds
 *  swaps fresh and recomputes the fee on confirmed output only. */
export async function buildSweepPlan(
  selection: SweepSelection,
  opts: PriceOptions = {}
): Promise<SweepPlan> {
  const { swaps, skipped } = await buildSwapTransactions(
    selection.dustTokens,
    selection.owner,
    opts
  );
  const quotedSolOutLamports = swaps.reduce(
    (sum, s) => sum + s.quotedSolOut,
    0
  );
  const transactions: PlannedTransaction[] = swaps.map((s) => ({
    kind: 'swap',
    ...s,
  }));

  const phase2 = buildFeeAndCloses({
    emptyAccounts: selection.emptyAccounts,
    owner: selection.owner,
    feeWallet: selection.feeWallet,
    feeBps: selection.feeBps,
    swapSolOutLamports: quotedSolOutLamports,
  });
  transactions.push(...phase2.transactions);

  const userReceivesLamports =
    phase2.rentLamports + quotedSolOutLamports - phase2.feeLamports;
  return {
    transactions,
    skippedTokens: skipped,
    summary: {
      accountsClosed: selection.emptyAccounts.length,
      tokensSwapped: swaps.length,
      quotedSolOutLamports,
      rentLamports: phase2.rentLamports,
      feeLamports: phase2.feeLamports,
      userReceivesLamports,
      usdEstimate:
        selection.solPriceUsd === null
          ? null
          : (userReceivesLamports / 1e9) * selection.solPriceUsd,
    },
  };
}
