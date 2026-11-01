import { getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { planCleanup } from '../src/cleanup';
import { GENESIS_HASH } from '../src/constants';
import { isCleanupError } from '../src/errors';
import { createCoreRpcTransport, createHttpTransport, RETRY_DEFAULTS } from '../src/rpc';
import { submitSignedTransaction, wasSent } from '../src/submit';
import { BLOCKHASH, NOW, scanFixture, testConfig } from './helpers';

// A fake node behind fetch: each call gets the next scripted answer for its method.
type Answer = { status: number; body?: unknown; retryAfter?: string } | 'network' | 'timeout';

function fakeNode(script: Record<string, Answer[]>) {
  const calls: { method: string; params: unknown[]; url: string }[] = [];
  const fetchImpl = (async (url: string, init: { body: string }) => {
    const { method, params, id } = JSON.parse(init.body) as { method: string; params: unknown[]; id: number };
    calls.push({ method, params, url });
    const queue = script[method] ?? [];
    const next = queue.length > 1 ? queue.shift() : queue[0];
    if (next === undefined) throw new Error(`no answer scripted for ${method}`);
    if (next === 'network') throw new TypeError('fetch failed');
    if (next === 'timeout') throw new DOMException('The operation was aborted.', 'AbortError');
    const headers = new Headers(next.retryAfter ? { 'retry-after': next.retryAfter } : {});
    return new Response(JSON.stringify({ jsonrpc: '2.0', id, ...(next.body as object) }), { status: next.status, headers });
  }) as unknown as typeof fetch;
  return { calls, fetchImpl };
}

const ok = (result: unknown): Answer => ({ status: 200, body: { result } });
const busy: Answer = { status: 429 };
const busyRpc: Answer = { status: 200, body: { error: { code: -32005, message: 'Too many requests' } } };

function transport(node: ReturnType<typeof fakeNode>, waits: number[], random = () => 1) {
  return createHttpTransport('https://rpc.example', {
    fetchImpl: node.fetchImpl,
    retry: { random, sleep: async (ms) => void waits.push(ms) },
  });
}

async function errorOf(fn: () => Promise<unknown>) {
  try {
    await fn();
  } catch (e) {
    if (isCleanupError(e)) return e;
    throw e;
  }
  throw new Error('expected an error');
}

describe('RPC transport: too many requests', () => {
  it('waits and tries again after HTTP 429, with a backoff that doubles up to the cap', async () => {
    const node = fakeNode({ getSlot: [busy, busy, busy, ok(42)] });
    const waits: number[] = [];
    expect(await transport(node, waits)('getSlot', [])).toBe(42);
    expect(node.calls).toHaveLength(4);
    expect(waits).toEqual([500, 1_000, 2_000]);
  });

  it('jitter: each wait is a random share of the backoff', async () => {
    const node = fakeNode({ getSlot: [busy, busy, ok(1)] });
    const waits: number[] = [];
    await transport(node, waits, () => 0.25)('getSlot', []);
    expect(waits).toEqual([125, 250]);
  });

  it('also treats JSON-RPC -32005 as too many requests', async () => {
    const node = fakeNode({ getSlot: [busyRpc, ok(7)] });
    expect(await transport(node, [])('getSlot', [])).toBe(7);
    expect(node.calls).toHaveLength(2);
  });

  it('honours Retry-After, never longer than the cap', async () => {
    const node = fakeNode({ getSlot: [{ status: 429, retryAfter: '3' }, { status: 429, retryAfter: '600' }, ok(1)] });
    const waits: number[] = [];
    await transport(node, waits, () => 0)('getSlot', []);
    expect(waits).toEqual([3_000, RETRY_DEFAULTS.maxDelayMs]);
  });

  it('stops after the set number of tries with a plain message', async () => {
    const node = fakeNode({ getSlot: [busy] });
    const waits: number[] = [];
    const e = await errorOf(() => transport(node, waits)('getSlot', []));
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toBe('The network is busy right now. Nothing was sent. Try again in a minute.');
    expect(node.calls).toHaveLength(RETRY_DEFAULTS.attempts);
    expect(waits).toHaveLength(RETRY_DEFAULTS.attempts - 1);
    expect(waits.reduce((a, b) => a + b, 0)).toBeLessThanOrEqual(RETRY_DEFAULTS.maxDelayMs * (RETRY_DEFAULTS.attempts - 1));
  });

  it('never retries anything else: a 5xx, a timeout or no answer is one call', async () => {
    for (const answer of [{ status: 502 } as Answer, 'timeout' as Answer, 'network' as Answer]) {
      const node = fakeNode({ getSlot: [answer, ok(1)] });
      const e = await errorOf(() => transport(node, [])('getSlot', []));
      expect(e.code).toBe('RPC_ERROR');
      expect(node.calls).toHaveLength(1);
    }
  });
});

describe('sending: never the same transaction twice', () => {
  const lifetime = { blockhash: BLOCKHASH, lastValidBlockHeight: 1150n };
  async function offered(): Promise<string> {
    const scan = await scanFixture('wallet-many-empty.json');
    const close = scan.accounts.filter((a) => a.closable).map((a) => a.address).slice(0, 2);
    const [tx] = planCleanup({ scan, selection: { close }, config: testConfig(), platform: 'web', lifetime, now: NOW });
    return tx?.base64 as string;
  }
  // Filler bytes stand in for a wallet's signature; no key is involved. Each test uses its own.
  function signed(b64: string, filler: number): { tx: string; sig: string } {
    const bytes = Buffer.from(b64, 'base64');
    bytes.fill(filler, 1, 65);
    return { tx: bytes.toString('base64'), sig: getBase58Decoder().decode(new Uint8Array(64).fill(filler)) };
  }
  const genesis = ok(GENESIS_HASH.devnet);
  const sends = (node: ReturnType<typeof fakeNode>) => node.calls.filter((c) => c.method === 'sendTransaction');

  it('a 429 on send is refused before the node takes anything, so it is tried again; then it is never sent again', async () => {
    const unsigned = await offered();
    const s = signed(unsigned, 0x21);
    const node = fakeNode({ getGenesisHash: [genesis], sendTransaction: [busy, busy, ok(s.sig)] });
    const rpc = transport(node, []);
    expect(await submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx })).toBe(s.sig);
    expect(sends(node)).toHaveLength(3);
    expect(sends(node).every((c) => c.params[0] === s.tx)).toBe(true);
    expect(wasSent(s.sig)).toBe(true);

    const again = await errorOf(() => submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx }));
    expect(again.code).toBe('ALREADY_SENT');
    expect(sends(node)).toHaveLength(3);
  });

  it('a send that gets no clear answer is never sent again and says how to check', async () => {
    for (const [answer, filler] of [['timeout', 0x22], ['network', 0x23], [{ status: 503 }, 0x24]] as [Answer, number][]) {
      const unsigned = await offered();
      const s = signed(unsigned, filler);
      const node = fakeNode({ getGenesisHash: [genesis], sendTransaction: [answer, ok(s.sig)] });
      const rpc = transport(node, []);
      const e = await errorOf(() => submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx }));
      expect(e.code).toBe('RPC_ERROR');
      expect(e.message).toBe('The network did not say whether it took the transaction. It will not be sent again. Scan again in a minute to see the result before you try again.');
      expect(wasSent(s.sig)).toBe(true);
      const again = await errorOf(() => submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx }));
      expect(again.code).toBe('ALREADY_SENT');
      expect(sends(node)).toHaveLength(1);
    }
  });

  it('a node that refused it (preflight failed, or still busy after every try) leaves it free to send after a fix', async () => {
    const unsigned = await offered();
    const s = signed(unsigned, 0x25);
    const preflight: Answer = { status: 200, body: { error: { code: -32002, message: 'Transaction simulation failed' } } };
    const node = fakeNode({ getGenesisHash: [genesis], sendTransaction: [preflight, ok(s.sig)] });
    const rpc = transport(node, []);
    expect((await errorOf(() => submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx }))).code).toBe('RPC_ERROR');
    expect(wasSent(s.sig)).toBe(false);

    const s2 = signed(unsigned, 0x26);
    const busyNode = fakeNode({ getGenesisHash: [genesis], sendTransaction: [busy] });
    const e = await errorOf(() => submitSignedTransaction({ rpc: transport(busyNode, []), config: testConfig(), offered: unsigned, signed: s2.tx }));
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toBe('The network is busy and the transaction was not sent. Nothing left your wallet. Try again in a minute.');
    expect(wasSent(s2.sig)).toBe(false);
  });
});

describe('the cleanup RPC through the core relay', () => {
  const core = (node: ReturnType<typeof fakeNode>, url = 'https://core.noventia.example') =>
    createCoreRpcTransport(url, { fetchImpl: node.fetchImpl, retry: { random: () => 1, sleep: async () => {} } });
  const refusal = (status: number, code: string): Answer => ({ status, body: { error: { code, message: code } } });

  it('posts JSON-RPC to {core}/v1/rpc and returns the node answer', async () => {
    const node = fakeNode({ getSlot: [ok(9)] });
    expect(await core(node, 'https://core.noventia.example/')('getSlot', [])).toBe(9);
    expect(node.calls[0]?.url).toBe('https://core.noventia.example/v1/rpc');
  });

  it('only an https core address without a path, or a local one for tests', () => {
    for (const bad of ['http://core.example', 'https://core.example/v1', 'ftp://x', 'https://mainnet.helius-rpc.com/?api-key=x']) {
      expect(() => createCoreRpcTransport(bad)).toThrow(/core address/);
    }
    expect(() => createCoreRpcTransport('http://127.0.0.1:8788')).not.toThrow();
  });

  it("busy_today stops at once with a plain message and is not retried", async () => {
    const node = fakeNode({ getSlot: [refusal(503, 'busy_today'), ok(1)] });
    const e = await errorOf(() => core(node)('getSlot', []));
    expect(e.code).toBe('BUSY_TODAY');
    expect(e.message).toBe("Cleanup has reached today's limit. Nothing was sent. Try again after 00:00 UTC.");
    expect(node.calls).toHaveLength(1);
  });

  it('429 from the relay is retried like any 429', async () => {
    const node = fakeNode({ getSlot: [refusal(429, 'rate_limited'), ok(3)] });
    expect(await core(node)('getSlot', [])).toBe(3);
    expect(node.calls).toHaveLength(2);
  });

  it('a method the relay does not allow is refused, not retried', async () => {
    const node = fakeNode({ getProgramAccounts: [refusal(403, 'method_not_allowed')] });
    const e = await errorOf(() => core(node)('getProgramAccounts', []));
    expect(e.code).toBe('RPC_ERROR');
    expect(e.message).toContain('method_not_allowed');
    expect(node.calls).toHaveLength(1);
  });

  describe('sending through the relay', () => {
    const lifetime = { blockhash: BLOCKHASH, lastValidBlockHeight: 1150n };
    async function offered(): Promise<string> {
      const scan = await scanFixture('wallet-many-empty.json');
      const close = scan.accounts.filter((a) => a.closable).map((a) => a.address).slice(0, 2);
      const [tx] = planCleanup({ scan, selection: { close }, config: testConfig(), platform: 'web', lifetime, now: NOW });
      return tx?.base64 as string;
    }
    function signed(b64: string, filler: number) {
      const bytes = Buffer.from(b64, 'base64');
      bytes.fill(filler, 1, 65);
      return { tx: bytes.toString('base64'), sig: getBase58Decoder().decode(new Uint8Array(64).fill(filler)) };
    }
    const genesis = ok(GENESIS_HASH.devnet);

    it('a refusal by the relay (busy_today, a 4xx with a code) leaves the transaction free to send later', async () => {
      const unsigned = await offered();
      for (const [answer, filler, code] of [[refusal(503, 'busy_today'), 0x31, 'BUSY_TODAY'], [refusal(403, 'method_not_allowed'), 0x32, 'RPC_ERROR']] as [Answer, number, string][]) {
        const s = signed(unsigned, filler);
        const node = fakeNode({ getGenesisHash: [genesis], sendTransaction: [answer] });
        const e = await errorOf(() => submitSignedTransaction({ rpc: core(node), config: testConfig(), offered: unsigned, signed: s.tx }));
        expect(e.code).toBe(code);
        expect(wasSent(s.sig)).toBe(false);
      }
    });

    it('busy_today on send says the transaction was not sent', async () => {
      const unsigned = await offered();
      const s = signed(unsigned, 0x33);
      const node = fakeNode({ getGenesisHash: [genesis], sendTransaction: [refusal(503, 'busy_today')] });
      const e = await errorOf(() => submitSignedTransaction({ rpc: core(node), config: testConfig(), offered: unsigned, signed: s.tx }));
      expect(e.message).toBe("Cleanup has reached today's limit, so the transaction was not sent. Nothing left your wallet. Try again after 00:00 UTC.");
    });

    it('a 502 or 504 from the relay may have been forwarded: never sent again', async () => {
      const unsigned = await offered();
      for (const [answer, filler] of [[refusal(502, 'source_unavailable'), 0x34], [{ status: 504 }, 0x35]] as [Answer, number][]) {
        const s = signed(unsigned, filler);
        const node = fakeNode({ getGenesisHash: [genesis], sendTransaction: [answer, ok(s.sig)] });
        const rpc = core(node);
        expect((await errorOf(() => submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx }))).code).toBe('RPC_ERROR');
        expect(wasSent(s.sig)).toBe(true);
        expect((await errorOf(() => submitSignedTransaction({ rpc, config: testConfig(), offered: unsigned, signed: s.tx }))).code).toBe('ALREADY_SENT');
      }
    });
  });
});
