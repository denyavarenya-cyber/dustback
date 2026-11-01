import { getBase58Decoder } from '@solana/kit';
import { describe, expect, it } from 'vitest';
import { planCleanup } from '../src/cleanup';
import { GENESIS_HASH } from '../src/constants';
import { isCleanupError } from '../src/errors';
import { PROGRAM_ID } from '../src/accounts';
import {
  createCoreRpcTransport,
  createHttpTransport,
  getGenesisHash,
  getLatestBlockhash,
  getMultipleAccounts,
  getParsedAccount,
  getSignatureStatuses,
  getTokenAccountsByOwner,
  RETRY_DEFAULTS,
  type RpcTransport,
  simulateTransaction,
} from '../src/rpc';
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
    const node = fakeNode({ getSlot: [{ status: 429, retryAfter: '3' }, { status: 429, retryAfter: '30' }, ok(1)] });
    const waits: number[] = [];
    await transport(node, waits, () => 0)('getSlot', []);
    expect(waits).toEqual([3_000, RETRY_DEFAULTS.maxDelayMs]);
  });

  it('a limit for the hour or the day stops at once and says when, without waiting', async () => {
    const at = Date.parse('2026-11-01T21:30:00Z');
    const t = (node: ReturnType<typeof fakeNode>, waits: number[]) =>
      createHttpTransport('https://rpc.example', { fetchImpl: node.fetchImpl, retry: { random: () => 1, sleep: async (ms) => void waits.push(ms), now: () => at } });
    const day = fakeNode({ getSlot: [{ status: 429, retryAfter: '9000' }, ok(1)] });
    const waits: number[] = [];
    const e = await errorOf(() => t(day, waits)('getSlot', []));
    expect(e.code).toBe('RATE_LIMITED');
    expect(e.message).toBe('The limit for now is reached. Nothing was sent. Try again after 00:00 UTC.');
    expect(day.calls).toHaveLength(1);
    expect(waits).toEqual([]);
    const hour = fakeNode({ sendTransaction: [{ status: 429, retryAfter: '1800' }] });
    expect((await errorOf(() => t(hour, [])('sendTransaction', []))).message).toBe(
      'The limit for now is reached, so the transaction was not sent. Nothing left your wallet. Try again in 30 minutes.',
    );
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

    it('upstream_failed, or a 502 or 504 without a code, may have been forwarded: never sent again', async () => {
      const unsigned = await offered();
      for (const [answer, filler] of [[refusal(502, 'upstream_failed'), 0x34], [{ status: 504 }, 0x35], [{ status: 502 }, 0x36]] as [Answer, number][]) {
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

describe('every call the module makes fits the core relay (core-api 1.2.0)', () => {
  // The relay's allowlist and the config keys it relays, from core-api 1.2.0 (poe-engine
  // src/server/rpc.ts, RPC_METHODS and the per-method checks). Checked on 1 November 2026
  // against the relay's own parser with every call recorded from this test suite.
  const READ = ['encoding', 'commitment', 'minContextSlot', 'dataSlice'];
  const ALLOWED: Record<string, { keys: string[]; configAt: number | null }> = {
    getGenesisHash: { keys: [], configAt: null },
    getLatestBlockhash: { keys: ['commitment', 'minContextSlot'], configAt: 0 },
    getTokenAccountsByOwner: { keys: ['encoding', 'commitment', 'minContextSlot'], configAt: 2 },
    getAccountInfo: { keys: READ, configAt: 1 },
    getMultipleAccounts: { keys: READ, configAt: 1 },
    getSignatureStatuses: { keys: ['searchTransactionHistory'], configAt: 1 },
    simulateTransaction: { keys: ['encoding', 'sigVerify', 'replaceRecentBlockhash', 'commitment', 'minContextSlot', 'innerInstructions', 'accounts'], configAt: 1 },
    sendTransaction: { keys: ['encoding', 'skipPreflight', 'preflightCommitment', 'maxRetries', 'minContextSlot'], configAt: 1 },
  };

  it('methods in the allowlist, config keys the relay forwards, token programs only', async () => {
    const calls: { method: string; params: readonly unknown[] }[] = [];
    const record: RpcTransport = async (method, params) => {
      calls.push({ method, params });
      throw new Error('recorded');
    };
    const tryIt = async (f: () => Promise<unknown>) => {
      try {
        await f();
      } catch {
        // only the request matters here
      }
    };
    const A = '4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T';
    await tryIt(() => getGenesisHash(record));
    await tryIt(() => getLatestBlockhash(record));
    await tryIt(() => getTokenAccountsByOwner(record, A, PROGRAM_ID.token));
    await tryIt(() => getTokenAccountsByOwner(record, A, PROGRAM_ID.token2022));
    await tryIt(() => getMultipleAccounts(record, [A]));
    await tryIt(() => getParsedAccount(record, A));
    await tryIt(() => getSignatureStatuses(record, ['2T5YSYCEKzfio3eCVzxH9rjxyvnTi9LCEbVJxy5qAtjx4PdermuVuTah3tbtz8KXGAiQUQQ1aX9PGzy9EfJGy2tA']));
    await tryIt(() => simulateTransaction(record, 'AQ==', [A]));
    const scan = await scanFixture('wallet-many-empty.json');
    const close = scan.accounts.filter((a) => a.closable).map((a) => a.address).slice(0, 2);
    const [tx] = planCleanup({ scan, selection: { close }, config: testConfig(), platform: 'web', lifetime: { blockhash: BLOCKHASH, lastValidBlockHeight: 1150n }, now: NOW });
    const bytes = Buffer.from(tx?.base64 as string, 'base64');
    bytes.fill(0x41, 1, 65);
    const genesisFirst: RpcTransport = async (method, params) => (method === 'getGenesisHash' ? GENESIS_HASH.devnet : record(method, params));
    await tryIt(() => submitSignedTransaction({ rpc: genesisFirst, config: testConfig(), offered: tx?.base64 as string, signed: bytes.toString('base64') }));

    const methods = new Set(calls.map((c) => c.method));
    expect([...methods].sort()).toEqual(Object.keys(ALLOWED).sort());
    for (const c of calls) {
      const rule = ALLOWED[c.method];
      expect(rule, c.method).toBeDefined();
      if (rule?.configAt === null) expect(c.params).toEqual([]);
      const cfg = rule?.configAt == null ? undefined : (c.params[rule.configAt] as Record<string, unknown> | undefined);
      for (const k of Object.keys(cfg ?? {})) expect(rule?.keys, `${c.method} config key ${k}`).toContain(k);
      if (c.method === 'getTokenAccountsByOwner') expect([PROGRAM_ID.token, PROGRAM_ID.token2022]).toContain((c.params[1] as { programId: string }).programId);
    }
  });
});
