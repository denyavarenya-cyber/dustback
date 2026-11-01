import { getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { planCleanup, previewCleanup } from '../src/cleanup';
import { createConfig } from '../src/config';
import { GENESIS_HASH } from '../src/constants';
import { isCleanupError } from '../src/errors';
import { submitSignedTransaction } from '../src/submit';
import { ADDR, BLOCKHASH, baseHandlers, fakeRpc, NOW, scanFixture, testConfig } from './helpers';

const lifetime = { blockhash: BLOCKHASH, lastValidBlockHeight: 1150n };

async function codeOf(fn: () => unknown): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return isCleanupError(e) ? e.code : String(e);
  }
  return undefined;
}

describe('previewCleanup shows the same numbers the signed transactions will carry', () => {
  it('matches planCleanup exactly, account by account and in total', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const close = scan.accounts.filter((a) => a.closable).map((a) => a.address);
    const config = testConfig();
    const preview = previewCleanup({ scan, selection: { close }, config, platform: 'web', now: NOW });
    const plan = planCleanup({ scan, selection: { close }, config, platform: 'web', lifetime, now: NOW });
    expect(preview.transactions.map((t) => t.accounts.map((a) => a.address))).toEqual(plan.map((t) => t.accounts.map((a) => a.address)));
    expect(preview.transactions.map((t) => t.feeLamports)).toEqual(plan.map((t) => t.fee?.lamports ?? 0n));
    expect(preview.totals.netLamports).toBe(plan.reduce((s, t) => s + t.netLamports, 0n));
    expect(preview.feeRecipient).toBe(ADDR.feeWallet);
    expect(preview.feeWalletSet).toBe(true);
  });

  it('works while the fee wallet is the placeholder, with the configured 7 percent and no recipient', async () => {
    const scan = await scanFixture('wallet-many-empty.json');
    const close = scan.accounts.filter((a) => a.closable).map((a) => a.address).slice(0, 3);
    const preview = previewCleanup({ scan, selection: { close }, config: createConfig(), platform: 'android', now: NOW });
    expect(preview.feeWalletSet).toBe(false);
    expect(preview.feeRecipient).toBeNull();
    expect(preview.feeBps).toBe(700);
    expect(preview.totals.feeLamports).toBe((3n * 2039280n * 700n) / 10000n);
    // but nothing signable can be built
    expect(await codeOf(() => planCleanup({ scan, selection: { close }, config: createConfig(), platform: 'android', lifetime, now: NOW }))).toBe(
      'FEE_WALLET_NOT_SET',
    );
  });

  it('is off on iOS and refuses protected accounts like the real plan', async () => {
    const scan = await scanFixture('wallet-nft.json');
    expect(await codeOf(() => previewCleanup({ scan, selection: { close: [] }, config: testConfig(), platform: 'ios', now: NOW }))).toBe(
      'FEATURE_DISABLED',
    );
    const nft = scan.accounts[0]?.address as string;
    expect(await codeOf(() => previewCleanup({ scan, selection: { close: [nft] }, config: testConfig(), platform: 'web', now: NOW }))).toBe(
      'PROTECTED',
    );
  });
});

describe('submitSignedTransaction', () => {
  async function offered(): Promise<string> {
    const scan = await scanFixture('wallet-many-empty.json');
    const close = scan.accounts.filter((a) => a.closable).map((a) => a.address).slice(0, 2);
    const [tx] = planCleanup({ scan, selection: { close }, config: testConfig(), platform: 'web', lifetime, now: NOW });
    return tx?.base64 as string;
  }

  // Wire format: one signature slot (shortvec 1, then 64 bytes), then the message.
  // Filler bytes stand in for a wallet's signature; no key is involved.
  function signWithFiller(b64: string, filler = 0x11): string {
    const bytes = Buffer.from(b64, 'base64');
    expect(bytes[0]).toBe(1);
    bytes.fill(filler, 1, 65);
    return bytes.toString('base64');
  }

  it('sends the signed bytes through our RPC with preflight and returns the signature', async () => {
    const unsigned = await offered();
    const signed = signWithFiller(unsigned);
    const expectedSig = getBase58Decoder().decode(new Uint8Array(64).fill(0x11));
    const rpc = fakeRpc({ ...baseHandlers, sendTransaction: () => expectedSig });
    const sig = await submitSignedTransaction({ rpc: rpc.transport, config: testConfig(), offered: unsigned, signed });
    expect(sig).toBe(expectedSig);
    const send = rpc.calls.find((c) => c.method === 'sendTransaction');
    expect(send?.params[0]).toBe(signed);
    expect(send?.params[1]).toMatchObject({ skipPreflight: false, preflightCommitment: 'confirmed', encoding: 'base64' });
  });

  it('refuses when the wallet changed the message', async () => {
    const unsigned = await offered();
    const bytes = Buffer.from(signWithFiller(unsigned), 'base64');
    const last = bytes.length - 1;
    bytes[last] = (bytes[last] ?? 0) ^ 0xff; // last byte of the fee amount
    const rpc = fakeRpc({ ...baseHandlers, sendTransaction: () => 'x' });
    expect(
      await codeOf(() => submitSignedTransaction({ rpc: rpc.transport, config: testConfig(), offered: unsigned, signed: bytes.toString('base64') })),
    ).toBe('UNSAFE_TRANSACTION');
    expect(rpc.calls.some((c) => c.method === 'sendTransaction')).toBe(false);
  });

  it('refuses an unsigned transaction and never sends on mainnet before approval', async () => {
    const unsigned = await offered();
    const rpc = fakeRpc({ ...baseHandlers, sendTransaction: () => 'x' });
    expect(await codeOf(() => submitSignedTransaction({ rpc: rpc.transport, config: testConfig(), offered: unsigned, signed: unsigned }))).toBe(
      'UNSAFE_TRANSACTION',
    );
    const mainnet = testConfig({ cluster: 'mainnet-beta' });
    const rpcMain = fakeRpc({ ...baseHandlers, getGenesisHash: () => GENESIS_HASH['mainnet-beta'], sendTransaction: () => 'x' });
    expect(
      await codeOf(() => submitSignedTransaction({ rpc: rpcMain.transport, config: mainnet, offered: unsigned, signed: signWithFiller(unsigned) })),
    ).toBe('MAINNET_BLOCKED');
    expect(rpcMain.calls).toHaveLength(0);
  });

  it('refuses to send when the RPC serves another cluster', async () => {
    const unsigned = await offered();
    const rpc = fakeRpc({ ...baseHandlers, getGenesisHash: () => GENESIS_HASH['mainnet-beta'], sendTransaction: () => 'x' });
    expect(
      // Its own filler: the one above was already sent, and a sent transaction is never sent again.
      await codeOf(() => submitSignedTransaction({ rpc: rpc.transport, config: testConfig(), offered: unsigned, signed: signWithFiller(unsigned, 0x12) })),
    ).toBe('CLUSTER_MISMATCH');
    expect(rpc.calls.some((c) => c.method === 'sendTransaction')).toBe(false);
  });
});
