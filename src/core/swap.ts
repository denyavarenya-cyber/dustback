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
      quotedSolOut: number;
      transaction: VersionedTransaction;
    }
  | {
      kind: 'closes';
      accounts: number;
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

async function buildSwapTransaction(
  token: PricedBalance,
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

export async function buildSweepPlan(
  selection: SweepSelection,
  opts: PriceOptions = {}
): Promise<SweepPlan> {
  const owner = new PublicKey(selection.owner);
  const transactions: PlannedTransaction[] = [];
  const skippedTokens: SkippedToken[] = [];

  let quotedSolOutLamports = 0;
  for (const token of selection.dustTokens) {
    const built = await buildSwapTransaction(token, selection.owner, opts);
    if (built === null) {
      skippedTokens.push({ mint: token.mint, pubkey: token.pubkey });
      continue;
    }
    quotedSolOutLamports += built.quotedSolOut;
    transactions.push({
      kind: 'swap',
      mint: token.mint,
      pubkey: token.pubkey,
      amountRaw: token.amountRaw,
      quotedSolOut: built.quotedSolOut,
      transaction: built.transaction,
    });
  }

  const rentLamports = selection.emptyAccounts.reduce(
    (sum, account) => sum + account.lamports,
    0
  );
  // v1 simplification: fee is 8% of rent + QUOTED swap output, computed at
  // build time. Actual swap output can differ within slippage; no post-hoc
  // correction, even when a swap later fails on-chain.
  const feeLamports = Math.floor(
    ((rentLamports + quotedSolOutLamports) * selection.feeBps) / 10000
  );

  const feeWallet = selection.feeWallet
    ? new PublicKey(selection.feeWallet)
    : owner;
  const feeInstruction =
    feeLamports > 0
      ? SystemProgram.transfer({
          fromPubkey: owner,
          toPubkey: feeWallet,
          lamports: feeLamports,
        })
      : null;

  // fee goes in the LAST transaction so a mid-batch abort cannot take the
  // fee before the closes it covers have been submitted
  const closeChunks = buildCloseChunks(selection.emptyAccounts, owner);
  closeChunks.forEach(({ transaction, accounts }, i) => {
    const includesFee =
      i === closeChunks.length - 1 && feeInstruction !== null;
    if (includesFee) transaction.add(feeInstruction!);
    transactions.push({
      kind: 'closes',
      accounts: accounts.length,
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

  const userReceivesLamports =
    rentLamports + quotedSolOutLamports - feeLamports;
  return {
    transactions,
    skippedTokens,
    summary: {
      accountsClosed: selection.emptyAccounts.length,
      tokensSwapped: transactions.filter((t) => t.kind === 'swap').length,
      quotedSolOutLamports,
      rentLamports,
      feeLamports,
      userReceivesLamports,
      usdEstimate:
        selection.solPriceUsd === null
          ? null
          : (userReceivesLamports / 1e9) * selection.solPriceUsd,
    },
  };
}
