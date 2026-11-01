import {
  address,
  type Address,
  appendTransactionMessageInstructions,
  blockhash,
  compileTransaction,
  compressTransactionMessageUsingAddressLookupTables,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getTransactionMessageSize,
  getTransactionMessageSizeLimit,
  type Instruction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit';
import type { LatestBlockhash } from './rpc';

export interface CompiledTransaction {
  /** Unsigned wire transaction, base64; what the wallet is asked to sign. */
  base64: string;
  /** Serialized size in bytes, signatures included. */
  bytes: number;
  sizeLimit: number;
}

export type AddressesByLookupTable = Record<string, string[]>;

function lifetimeOf(l: LatestBlockhash) {
  return { blockhash: blockhash(l.blockhash), lastValidBlockHeight: l.lastValidBlockHeight };
}

function legacyMessage(feePayer: string, lifetime: LatestBlockhash, instructions: readonly Instruction[]) {
  return pipe(
    createTransactionMessage({ version: 'legacy' }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetimeOf(lifetime), m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
}

function v0Message(
  feePayer: string,
  lifetime: LatestBlockhash,
  instructions: readonly Instruction[],
  lookupTables: AddressesByLookupTable,
) {
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(address(feePayer), m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(lifetimeOf(lifetime), m),
    (m) => appendTransactionMessageInstructions(instructions, m),
  );
  const tables: Record<Address, Address[]> = {};
  for (const [table, addresses] of Object.entries(lookupTables)) {
    tables[address(table)] = addresses.map((a) => address(a));
  }
  return compressTransactionMessageUsingAddressLookupTables(message, tables);
}

/** Legacy and v0 transactions are capped at 1232 bytes. */
export const LEGACY_SIZE_LIMIT = 1232;
const MAX_LEGACY_ACCOUNT_KEYS = 64;

function shortVecLength(n: number): number {
  return n < 0x80 ? 1 : n < 0x4000 ? 2 : 3;
}

/**
 * Exact serialized size of a legacy transaction with one signature, counted
 * from the wire format without compiling: signatures, header, unique account
 * keys, blockhash, then each instruction. Linear in the number of
 * instructions, so batching stays fast on phones. Tests check it against the
 * compiled size.
 */
export function legacySize(feePayer: string, instructions: readonly Instruction[]): number {
  const keys = new Set<string>([feePayer]);
  let ixBytes = 0;
  for (const ix of instructions) {
    keys.add(ix.programAddress);
    const accounts = ix.accounts ?? [];
    for (const a of accounts) keys.add(a.address);
    const dataLength = ix.data?.length ?? 0;
    ixBytes += 1 + shortVecLength(accounts.length) + accounts.length + shortVecLength(dataLength) + dataLength;
  }
  // A legacy message holds at most 64 account keys; more can never be sent.
  if (keys.size > MAX_LEGACY_ACCOUNT_KEYS) return Number.POSITIVE_INFINITY;
  const signatures = 1;
  const message = 3 + shortVecLength(keys.size) + 32 * keys.size + 32 + shortVecLength(instructions.length) + ixBytes;
  return shortVecLength(signatures) + 64 * signatures + message;
}

/** Size a legacy transaction would have; used to batch closes under the limit. */
export function measureLegacy(
  feePayer: string,
  lifetime: LatestBlockhash,
  instructions: readonly Instruction[],
): { bytes: number; sizeLimit: number } {
  const message = legacyMessage(feePayer, lifetime, instructions);
  return { bytes: getTransactionMessageSize(message), sizeLimit: getTransactionMessageSizeLimit(message) };
}

export function compileLegacy(
  feePayer: string,
  lifetime: LatestBlockhash,
  instructions: readonly Instruction[],
): CompiledTransaction {
  const message = legacyMessage(feePayer, lifetime, instructions);
  return {
    base64: getBase64EncodedWireTransaction(compileTransaction(message)),
    bytes: getTransactionMessageSize(message),
    sizeLimit: getTransactionMessageSizeLimit(message),
  };
}

export function compileV0(
  feePayer: string,
  lifetime: LatestBlockhash,
  instructions: readonly Instruction[],
  lookupTables: AddressesByLookupTable,
): CompiledTransaction {
  const message = v0Message(feePayer, lifetime, instructions, lookupTables);
  return {
    base64: getBase64EncodedWireTransaction(compileTransaction(message)),
    bytes: getTransactionMessageSize(message),
    sizeLimit: getTransactionMessageSizeLimit(message),
  };
}
