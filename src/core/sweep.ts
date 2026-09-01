import {
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
} from '@solana/web3.js';
import {
  EmptyAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './scan';

// CloseAccount is instruction 9 in both token programs.
const CLOSE_ACCOUNT_INDEX = 9;
export const MAX_CLOSES_PER_TX = 12;

export interface SignatureStatusLike {
  err: unknown;
  confirmationStatus?: string | null;
}

export interface StatusConnection {
  getSignatureStatuses(
    signatures: string[]
  ): Promise<{ value: (SignatureStatusLike | null)[] }>;
}

export type ConfirmationOutcome = 'confirmed' | 'failed' | 'timeout';

export interface SweepSummary {
  accountsClosed: number;
  totalRentLamports: number;
  feeLamports: number;
  userReceivesLamports: number;
}

export interface CloseBatch {
  transactions: Transaction[];
  summary: SweepSummary;
}

function closeAccountInstruction(
  account: EmptyAccount,
  owner: PublicKey
): TransactionInstruction {
  return new TransactionInstruction({
    programId:
      account.program === 'token2022'
        ? TOKEN_2022_PROGRAM_ID
        : TOKEN_PROGRAM_ID,
    keys: [
      {
        pubkey: new PublicKey(account.pubkey),
        isSigner: false,
        isWritable: true,
      },
      { pubkey: owner, isSigner: false, isWritable: true },
      { pubkey: owner, isSigner: true, isWritable: false },
    ],
    data: Buffer.from([CLOSE_ACCOUNT_INDEX]),
  });
}

export function buildCloseTransactions(
  emptyAccounts: EmptyAccount[],
  owner: PublicKey,
  feeWallet: PublicKey,
  feeBps: number
): CloseBatch {
  const totalRentLamports = emptyAccounts.reduce(
    (sum, account) => sum + account.lamports,
    0
  );
  const feeLamports = Math.floor((totalRentLamports * feeBps) / 10000);
  const summary: SweepSummary = {
    accountsClosed: emptyAccounts.length,
    totalRentLamports,
    feeLamports,
    userReceivesLamports: totalRentLamports - feeLamports,
  };

  const transactions: Transaction[] = [];
  for (let i = 0; i < emptyAccounts.length; i += MAX_CLOSES_PER_TX) {
    const tx = new Transaction();
    tx.feePayer = owner;
    for (const account of emptyAccounts.slice(i, i + MAX_CLOSES_PER_TX)) {
      tx.add(closeAccountInstruction(account, owner));
    }
    transactions.push(tx);
  }
  if (transactions.length > 0 && feeLamports > 0) {
    transactions[transactions.length - 1].add(
      SystemProgram.transfer({
        fromPubkey: owner,
        toPubkey: feeWallet,
        lamports: feeLamports,
      })
    );
  }

  return { transactions, summary };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function waitForConfirmations(
  connection: StatusConnection,
  signatures: string[],
  opts: { timeoutMs?: number; pollIntervalMs?: number } = {}
): Promise<ConfirmationOutcome> {
  const { timeoutMs = 30000, pollIntervalMs = 1500 } = opts;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      const { value } = await connection.getSignatureStatuses(signatures);
      if (value.some((status) => status?.err != null)) return 'failed';
      const allConfirmed = value.every(
        (status) =>
          status?.confirmationStatus === 'confirmed' ||
          status?.confirmationStatus === 'finalized'
      );
      if (allConfirmed) return 'confirmed';
    } catch {
      // transient RPC error: keep polling
    }
    if (Date.now() >= deadline) return 'timeout';
    if (pollIntervalMs > 0) await sleep(pollIntervalMs);
  }
}
