import { getBase58Decoder, getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit';
import { assertCanSend, type CleanupConfig } from './config';
import { CleanupError } from './errors';
import { assertCluster, type RpcTransport } from './rpc';

const base64 = getBase64Encoder();
const base58 = getBase58Decoder();

function decode(b64: string, what: string) {
  try {
    const tx = getTransactionDecoder().decode(new Uint8Array(base64.encode(b64)));
    const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
      staticAccounts: string[];
    };
    return { tx, feePayer: String(message.staticAccounts[0] ?? '') };
  } catch (e) {
    throw new CleanupError('BAD_RESPONSE', `${what} is not a valid transaction`, e);
  }
}

/**
 * Signatures handed to the network in this app session, or possibly handed over
 * (no clear answer). A double tap, a retry or a second screen can never send the
 * same transaction again: a new try needs a new transaction, built and signed again.
 */
const sent = new Set<string>();
const SENT_MAX = 500;

function remember(signature: string): void {
  if (sent.size >= SENT_MAX) {
    const oldest = sent.values().next().value;
    if (oldest !== undefined) sent.delete(oldest);
  }
  sent.add(signature);
}

/** True when this signature was sent, or may have been, in this session. */
export function wasSent(signature: string): boolean {
  return sent.has(signature);
}

/** A node that answered with a JSON-RPC error refused the transaction; anything else (timeout, 5xx, no answer) is unknown. */
function nodeRefused(e: unknown): boolean {
  return e instanceof CleanupError && (e.code === 'RATE_LIMITED' || (e.code === 'RPC_ERROR' && isRpcErrorBody(e.details)));
}

/** A JSON-RPC error object from the node's answer (not a thrown Error such as an abort). */
function isRpcErrorBody(v: unknown): boolean {
  if (typeof v !== 'object' || v === null || v instanceof Error) return false;
  const o = v as { code?: unknown; message?: unknown };
  return typeof o.code === 'number' && typeof o.message === 'string';
}

function sameBytes(a: ArrayLike<number>, b: ArrayLike<number>): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
  return true;
}

/**
 * Sends a transaction the user signed in their wallet, through our RPC with
 * preflight. Refuses if the wallet changed anything in the message we offered
 * (amounts, accounts, fee): the user must sign exactly what the screen showed.
 */
export async function submitSignedTransaction(args: {
  rpc: RpcTransport;
  config: CleanupConfig;
  /** The unsigned base64 from the offer. */
  offered: string;
  /** The same transaction as the wallet returned it, signed. */
  signed: string;
}): Promise<string> {
  assertCanSend(args.config);
  const offered = decode(args.offered, 'the offered transaction');
  const signed = decode(args.signed, 'the signed transaction');
  if (!sameBytes(offered.tx.messageBytes, signed.tx.messageBytes)) {
    throw new CleanupError('UNSAFE_TRANSACTION', 'the wallet changed the transaction, so it was not sent');
  }
  const signatures = Object.entries(signed.tx.signatures);
  if (signatures.length !== 1) throw new CleanupError('UNSAFE_TRANSACTION', 'exactly one signature is expected');
  const [signer, signature] = signatures[0] as [string, Uint8Array | null];
  if (signer !== signed.feePayer || signature === null || signature.every((b) => b === 0)) {
    throw new CleanupError('UNSAFE_TRANSACTION', 'the transaction is not signed by the wallet that pays for it');
  }
  const expected = base58.decode(signature);
  if (sent.has(expected)) {
    throw new CleanupError('ALREADY_SENT', 'This transaction was already sent and will not be sent again. Its result is being checked.', { signature: expected });
  }
  await assertCluster(args.rpc, args.config.cluster);
  let result: unknown;
  try {
    // One call. The transport repeats it only after "too many requests", which the
    // node answers before taking anything; maxRetries is the node's own rebroadcast
    // of this one transaction to the leaders, never a second transaction.
    result = await args.rpc('sendTransaction', [
      args.signed,
      { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 },
    ]);
  } catch (e) {
    if (nodeRefused(e)) throw e;
    remember(expected);
    throw new CleanupError(
      'RPC_ERROR',
      'The network did not say whether it took the transaction. It will not be sent again. Scan again in a minute to see the result before you try again.',
      { signature: expected, cause: e },
    );
  }
  remember(expected);
  if (result !== expected) throw new CleanupError('BAD_RESPONSE', 'the RPC returned another signature');
  return expected;
}
