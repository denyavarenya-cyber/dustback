import { PublicKey, SystemInstruction, SystemProgram } from '@solana/web3.js';
import { buildCloseTransactions, MAX_CLOSES_PER_TX } from './sweep';
import {
  EmptyAccount,
  TOKEN_2022_PROGRAM_ID,
  TOKEN_PROGRAM_ID,
} from './scan';

const OWNER = PublicKey.unique();
const FEE_WALLET = PublicKey.unique();
const FEE_BPS = 800;

function accounts(
  n: number,
  lamports = 2039280,
  program: EmptyAccount['program'] = 'token'
): EmptyAccount[] {
  return Array.from({ length: n }, () => ({
    pubkey: PublicKey.unique().toBase58(),
    program,
    lamports,
  }));
}

function build(empties: EmptyAccount[]) {
  return buildCloseTransactions(empties, OWNER, FEE_WALLET, FEE_BPS);
}

describe('buildCloseTransactions', () => {
  it.each([
    [11, 1],
    [12, 1],
    [13, 2],
    [25, 3],
  ])('chunks %i accounts into %i transactions', (count, expectedTxs) => {
    const { transactions } = build(accounts(count));
    expect(transactions).toHaveLength(expectedTxs);
    const closesPerTx = transactions.map(
      (tx) =>
        tx.instructions.filter((ix) => !ix.programId.equals(SystemProgram.programId))
          .length
    );
    expect(closesPerTx.reduce((a, b) => a + b, 0)).toBe(count);
    for (const closes of closesPerTx) {
      expect(closes).toBeLessThanOrEqual(MAX_CLOSES_PER_TX);
    }
  });

  it('appends the fee transfer only to the last transaction', () => {
    const { transactions, summary } = build(accounts(25));
    const transferCounts = transactions.map(
      (tx) =>
        tx.instructions.filter((ix) => ix.programId.equals(SystemProgram.programId))
          .length
    );
    expect(transferCounts).toEqual([0, 0, 1]);

    const last = transactions[2].instructions;
    const transfer = SystemInstruction.decodeTransfer(last[last.length - 1]);
    expect(transfer.fromPubkey.equals(OWNER)).toBe(true);
    expect(transfer.toPubkey.equals(FEE_WALLET)).toBe(true);
    expect(Number(transfer.lamports)).toBe(summary.feeLamports);
  });

  it('computes the fee rounding down', () => {
    const { summary } = build(accounts(1, 1111));
    // 1111 * 800 / 10000 = 88.88
    expect(summary).toEqual({
      accountsClosed: 1,
      totalRentLamports: 1111,
      feeLamports: 88,
      userReceivesLamports: 1023,
    });
  });

  it('uses the right program id per account', () => {
    const empties = [
      ...accounts(1, 2039280, 'token'),
      ...accounts(1, 2568240, 'token2022'),
    ];
    const { transactions } = build(empties);
    const [legacyIx, t22Ix] = transactions[0].instructions;
    expect(legacyIx.programId.equals(TOKEN_PROGRAM_ID)).toBe(true);
    expect(t22Ix.programId.equals(TOKEN_2022_PROGRAM_ID)).toBe(true);
  });

  it('closes into the owner with the owner as signing authority', () => {
    const empties = accounts(1);
    const { transactions } = build(empties);
    const ix = transactions[0].instructions[0];
    expect(ix.keys[0].pubkey.toBase58()).toBe(empties[0].pubkey);
    expect(ix.keys[1].pubkey.equals(OWNER)).toBe(true);
    expect(ix.keys[2]).toMatchObject({ isSigner: true });
    expect(ix.keys[2].pubkey.equals(OWNER)).toBe(true);
    expect(ix.data).toEqual(Buffer.from([9]));
    expect(transactions[0].feePayer?.equals(OWNER)).toBe(true);
  });

  it('returns an empty batch for zero accounts', () => {
    expect(build([])).toEqual({
      transactions: [],
      summary: {
        accountsClosed: 0,
        totalRentLamports: 0,
        feeLamports: 0,
        userReceivesLamports: 0,
      },
    });
  });
});
