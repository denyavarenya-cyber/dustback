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
