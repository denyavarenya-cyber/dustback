import { getBase58Encoder } from '@solana/kit';
import type { Cluster } from './config';
import { CleanupError } from './errors';
import { getSignatureStatuses, type RpcTransport } from './rpc';

export type Outcome = 'confirmed' | 'failed' | 'timeout';

const base58 = getBase58Encoder();

/** A transaction signature is 64 bytes in base58. Anything else is refused. */
export function isSignature(s: unknown): s is string {
  if (typeof s !== 'string' || s.length < 64 || s.length > 88) return false;
  try {
    return base58.encode(s).length === 64;
  } catch {
    return false;
  }
}

/** Link to the transaction on the official explorer, on the right cluster. */
export function explorerTxUrl(signature: string, cluster: Cluster): string {
  if (!isSignature(signature)) throw new CleanupError('BAD_RESPONSE', 'not a transaction signature');
  const suffix = cluster === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/tx/${signature}${suffix}`;
}

function isAddressText(addr: string): boolean {
  try {
    return base58.encode(addr).length === 32;
  } catch {
    return false;
  }
}

export function explorerAddressUrl(addr: string, cluster: Cluster): string {
  if (!isAddressText(addr)) throw new CleanupError('INVALID_ADDRESS', 'not an address');
  const suffix = cluster === 'devnet' ? '?cluster=devnet' : '';
  return `https://explorer.solana.com/address/${addr}${suffix}`;
}

/** Polls until every signature is final either way, or the time runs out. */
export async function waitForOutcomes(args: {
  rpc: RpcTransport;
  signatures: readonly string[];
  timeoutMs?: number;
  pollMs?: number;
  sleep?: (ms: number) => Promise<void>;
  now?: () => number;
}): Promise<Outcome[]> {
  const { rpc, signatures, timeoutMs = 60_000, pollMs = 1_500 } = args;
  const sleep = args.sleep ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
  const now = args.now ?? Date.now;
  const deadline = now() + timeoutMs;
  const outcomes: (Outcome | null)[] = signatures.map(() => null);
  for (;;) {
    try {
      const statuses = await getSignatureStatuses(rpc, signatures);
      statuses.forEach((s, i) => {
        if (outcomes[i] !== null || s === null) return;
        if (s.err !== null) outcomes[i] = 'failed';
        else if (s.confirmationStatus === 'confirmed' || s.confirmationStatus === 'finalized') outcomes[i] = 'confirmed';
      });
    } catch {
      // a transient RPC error: keep polling until the deadline
    }
    if (outcomes.every((o) => o !== null)) return outcomes as Outcome[];
    if (now() >= deadline) return outcomes.map((o) => o ?? 'timeout');
    await sleep(pollMs);
  }
}
