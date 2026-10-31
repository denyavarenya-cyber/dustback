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
  await assertCluster(args.rpc, args.config.cluster);
  const result = await args.rpc('sendTransaction', [
    args.signed,
    { encoding: 'base64', skipPreflight: false, preflightCommitment: 'confirmed', maxRetries: 3 },
  ]);
  const expected = base58.decode(signature);
  if (result !== expected) throw new CleanupError('BAD_RESPONSE', 'the RPC returned another signature');
  return expected;
}
