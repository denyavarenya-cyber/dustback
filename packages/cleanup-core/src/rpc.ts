import { getBase64Encoder, isAddress } from '@solana/kit';
import { GENESIS_HASH } from './constants';
import type { Cluster } from './config';
import { CleanupError } from './errors';

/**
 * One JSON-RPC call. The app passes an HTTP transport; tests pass recorded
 * responses. Everything that comes back is treated as untrusted input.
 */
export type RpcTransport = (method: string, params: readonly unknown[]) => Promise<unknown>;

export interface RetryOptions {
  /** Tries in all, the first one included. */
  attempts?: number;
  /** Backoff before try n is a random time up to min(maxDelayMs, baseDelayMs * 2^(n-1)). */
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** For tests. */
  random?: () => number;
  sleep?: (ms: number) => Promise<void>;
}

export interface HttpTransportOptions {
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  headers?: Record<string, string>;
  retry?: RetryOptions;
}

export const RETRY_DEFAULTS = { attempts: 5, baseDelayMs: 500, maxDelayMs: 8_000 } as const;

/** JSON-RPC "Too many requests" (Helius and Solana Labs nodes). */
const RPC_TOO_MANY = -32005;

function retryAfterMs(res: Response): number | null {
  const v = Number(res.headers.get('retry-after'));
  return Number.isFinite(v) && v > 0 ? v * 1000 : null;
}

/**
 * JSON-RPC over HTTP. A "too many requests" answer (HTTP 429 or JSON-RPC
 * -32005) means the node refused the call before doing anything, so it is
 * tried again after a backoff with full jitter, honouring Retry-After, up to
 * `retry.attempts` tries; then it stops with RATE_LIMITED and a plain message.
 * Nothing else is retried here: a timeout or a 5xx on sendTransaction may mean
 * the node already took the transaction, so it is never sent again blindly
 * (submitSignedTransaction and waitForOutcomes handle that case).
 */
export function createHttpTransport(url: string, options: HttpTransportOptions = {}): RpcTransport {
  const { fetchImpl = fetch, timeoutMs = 20_000, headers = {} } = options;
  const attempts = Math.max(1, Math.floor(options.retry?.attempts ?? RETRY_DEFAULTS.attempts));
  const base = options.retry?.baseDelayMs ?? RETRY_DEFAULTS.baseDelayMs;
  const cap = options.retry?.maxDelayMs ?? RETRY_DEFAULTS.maxDelayMs;
  const random = options.retry?.random ?? Math.random;
  const sleep = options.retry?.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  let id = 0;

  async function once(method: string, params: readonly unknown[]): Promise<{ busy: true; waitMs: number | null } | { busy: false; result: unknown }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchImpl(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++id, method, params }),
        signal: controller.signal,
      });
      if (res.status === 429) return { busy: true, waitMs: retryAfterMs(res) };
      if (!res.ok) throw new CleanupError('RPC_ERROR', `RPC answered HTTP ${res.status} to ${method}`);
      const body = (await res.json()) as { result?: unknown; error?: { code?: unknown; message?: unknown } };
      if (body.error !== undefined) {
        if (body.error.code === RPC_TOO_MANY) return { busy: true, waitMs: retryAfterMs(res) };
        throw new CleanupError('RPC_ERROR', `RPC error on ${method}: ${String(body.error.message)}`, body.error);
      }
      return { busy: false, result: body.result };
    } catch (e) {
      if (e instanceof CleanupError) throw e;
      throw new CleanupError('RPC_ERROR', `RPC request ${method} failed`, e);
    } finally {
      clearTimeout(timer);
    }
  }

  return async (method, params) => {
    for (let n = 1; ; n++) {
      const answer = await once(method, params);
      if (!answer.busy) return answer.result;
      if (n >= attempts) {
        throw new CleanupError(
          'RATE_LIMITED',
          method === 'sendTransaction'
            ? 'The network is busy and the transaction was not sent. Nothing left your wallet. Try again in a minute.'
            : 'The network is busy right now. Nothing was sent. Try again in a minute.',
          { method, attempts: n },
        );
      }
      const backoff = Math.min(cap, base * 2 ** (n - 1)) * random();
      await sleep(Math.min(cap, Math.max(backoff, answer.waitMs ?? 0)));
    }
  };
}

// ---- small validators for untrusted JSON ----

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

export function bad(what: string): never {
  throw new CleanupError('BAD_RESPONSE', `unexpected response: ${what}`);
}

function valueOf(result: unknown, what: string): unknown {
  if (!isRecord(result) || !('value' in result)) bad(`${what} has no value`);
  return result.value;
}

export function toBigInt(v: unknown, what: string): bigint {
  if (typeof v === 'number' && Number.isSafeInteger(v) && v >= 0) return BigInt(v);
  if (typeof v === 'string' && /^[0-9]{1,20}$/.test(v)) return BigInt(v);
  if (typeof v === 'bigint' && v >= 0n) return v;
  return bad(`${what} is not an unsigned integer`);
}

const base64 = getBase64Encoder();

export function decodeBase64(s: unknown, what: string): Uint8Array {
  if (typeof s !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(s)) bad(`${what} is not base64`);
  return new Uint8Array(base64.encode(s));
}

// ---- typed calls ----

export async function getGenesisHash(rpc: RpcTransport): Promise<string> {
  const r = await rpc('getGenesisHash', []);
  if (typeof r !== 'string') bad('genesis hash');
  return r;
}

/** Proves the endpoint serves the configured cluster before anything is built. */
export async function assertCluster(rpc: RpcTransport, cluster: Cluster): Promise<void> {
  const hash = await getGenesisHash(rpc);
  if (hash !== GENESIS_HASH[cluster]) {
    throw new CleanupError('CLUSTER_MISMATCH', `the RPC endpoint does not serve ${cluster}`);
  }
}

export interface LatestBlockhash {
  blockhash: string;
  lastValidBlockHeight: bigint;
}

export async function getLatestBlockhash(rpc: RpcTransport): Promise<LatestBlockhash> {
  const v = valueOf(await rpc('getLatestBlockhash', [{ commitment: 'confirmed' }]), 'getLatestBlockhash');
  if (!isRecord(v) || typeof v.blockhash !== 'string' || !isAddress(v.blockhash)) bad('blockhash');
  return { blockhash: v.blockhash, lastValidBlockHeight: toBigInt(v.lastValidBlockHeight, 'lastValidBlockHeight') };
}

/** Raw jsonParsed entries; parsing and validation happen in accounts.ts. */
export async function getTokenAccountsByOwner(
  rpc: RpcTransport,
  owner: string,
  programId: string,
): Promise<unknown[]> {
  const v = valueOf(
    await rpc('getTokenAccountsByOwner', [
      owner,
      { programId },
      { encoding: 'jsonParsed', commitment: 'confirmed' },
    ]),
    'getTokenAccountsByOwner',
  );
  if (!Array.isArray(v)) bad('token account list');
  return v;
}

export interface RawAccount {
  lamports: bigint;
  owner: string;
  data: Uint8Array;
}

function parseBase64Account(a: unknown, what: string): RawAccount | null {
  if (a === null) return null;
  if (!isRecord(a) || !Array.isArray(a.data) || a.data[1] !== 'base64') bad(`${what} account`);
  if (typeof a.owner !== 'string' || !isAddress(a.owner)) bad(`${what} owner`);
  return { lamports: toBigInt(a.lamports, `${what} lamports`), owner: a.owner, data: decodeBase64(a.data[0], what) };
}

export async function getMultipleAccounts(
  rpc: RpcTransport,
  addresses: readonly string[],
): Promise<(RawAccount | null)[]> {
  if (addresses.length === 0) return [];
  const v = valueOf(
    await rpc('getMultipleAccounts', [addresses, { encoding: 'base64', commitment: 'confirmed' }]),
    'getMultipleAccounts',
  );
  if (!Array.isArray(v) || v.length !== addresses.length) bad('account list length');
  return v.map((a, i) => parseBase64Account(a, `account ${addresses[i]}`));
}

export async function getParsedAccount(rpc: RpcTransport, address: string): Promise<unknown> {
  return valueOf(
    await rpc('getAccountInfo', [address, { encoding: 'jsonParsed', commitment: 'confirmed' }]),
    'getAccountInfo',
  );
}

export interface SimulationResult {
  err: unknown;
  logs: string[];
  unitsConsumed: number | null;
  /** Post-simulation state of the requested addresses, in request order. */
  accounts: (RawAccount | null)[];
}

export async function simulateTransaction(
  rpc: RpcTransport,
  base64Transaction: string,
  watchAddresses: readonly string[] = [],
): Promise<SimulationResult> {
  const config: Record<string, unknown> = {
    encoding: 'base64',
    commitment: 'confirmed',
    sigVerify: false,
    // Never replace the blockhash: an expired transaction must fail here.
    replaceRecentBlockhash: false,
  };
  if (watchAddresses.length > 0) config.accounts = { addresses: watchAddresses, encoding: 'base64' };
  const v = valueOf(await rpc('simulateTransaction', [base64Transaction, config]), 'simulateTransaction');
  if (!isRecord(v)) bad('simulation value');
  const logs = Array.isArray(v.logs) ? v.logs.filter((l): l is string => typeof l === 'string') : [];
  const units = typeof v.unitsConsumed === 'number' && Number.isSafeInteger(v.unitsConsumed) ? v.unitsConsumed : null;
  let accounts: (RawAccount | null)[] = [];
  if (watchAddresses.length > 0) {
    if (!Array.isArray(v.accounts) || v.accounts.length !== watchAddresses.length) {
      if (v.err === null || v.err === undefined) bad('simulation accounts');
      accounts = watchAddresses.map(() => null);
    } else {
      accounts = v.accounts.map((a, i) => parseBase64Account(a, `simulated ${watchAddresses[i]}`));
    }
  }
  return { err: v.err ?? null, logs, unitsConsumed: units, accounts };
}

export interface SignatureStatus {
  err: unknown;
  confirmationStatus: string | null;
}

export async function getSignatureStatuses(
  rpc: RpcTransport,
  signatures: readonly string[],
): Promise<(SignatureStatus | null)[]> {
  const v = valueOf(await rpc('getSignatureStatuses', [signatures]), 'getSignatureStatuses');
  if (!Array.isArray(v) || v.length !== signatures.length) bad('signature status list');
  return v.map((s) => {
    if (s === null) return null;
    if (!isRecord(s)) bad('signature status');
    return {
      err: s.err ?? null,
      confirmationStatus: typeof s.confirmationStatus === 'string' ? s.confirmationStatus : null,
    };
  });
}
