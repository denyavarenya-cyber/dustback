import { AccountRole, type Address, address, type Instruction } from '@solana/kit';
import {
  COMPUTE_BUDGET_IX,
  COMPUTE_BUDGET_PROGRAM,
  HARVEST_WITHHELD_TOKENS_TO_MINT,
  SYSTEM_IX_TRANSFER,
  SYSTEM_PROGRAM,
  TOKEN_IX,
} from './constants';

function u32le(n: number): number[] {
  const b = new Uint8Array(4);
  new DataView(b.buffer).setUint32(0, n, true);
  return [...b];
}

function u64le(n: bigint): number[] {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, n, true);
  return [...b];
}

/** CloseAccount: the account's lamports go to `destination`; the owner signs. */
export function closeAccountInstruction(
  programId: string,
  account: string,
  destination: string,
  owner: string,
): Instruction {
  return {
    programAddress: address(programId),
    accounts: [
      { address: address(account), role: AccountRole.WRITABLE },
      { address: address(destination), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY_SIGNER },
    ],
    data: new Uint8Array([TOKEN_IX.CloseAccount]),
  };
}

/**
 * Token-2022 HarvestWithheldTokensToMint. Permissionless: moves withheld
 * transfer fees (which belong to the mint's fee authority, never to the
 * holder) from the account to the mint, so the account can be closed.
 */
export function harvestWithheldInstruction(programId: string, mint: string, sources: string[]): Instruction {
  return {
    programAddress: address(programId),
    accounts: [
      { address: address(mint), role: AccountRole.WRITABLE },
      ...sources.map((s) => ({ address: address(s), role: AccountRole.WRITABLE })),
    ],
    data: new Uint8Array([TOKEN_IX.TransferFeeExtension, HARVEST_WITHHELD_TOKENS_TO_MINT]),
  };
}

/** BurnChecked for the exact amount the user confirmed. */
export function burnCheckedInstruction(
  programId: string,
  account: string,
  mint: string,
  owner: string,
  amount: bigint,
  decimals: number,
): Instruction {
  return {
    programAddress: address(programId),
    accounts: [
      { address: address(account), role: AccountRole.WRITABLE },
      { address: address(mint), role: AccountRole.WRITABLE },
      { address: address(owner), role: AccountRole.READONLY_SIGNER },
    ],
    data: new Uint8Array([TOKEN_IX.BurnChecked, ...u64le(amount), decimals]),
  };
}

/** System transfer; used only for the visible fee step. */
export function transferSolInstruction(from: string, to: string, lamports: bigint): Instruction {
  return {
    programAddress: SYSTEM_PROGRAM,
    accounts: [
      { address: address(from), role: AccountRole.WRITABLE_SIGNER },
      { address: address(to), role: AccountRole.WRITABLE },
    ],
    data: new Uint8Array([...u32le(SYSTEM_IX_TRANSFER), ...u64le(lamports)]),
  };
}

export function setComputeUnitLimitInstruction(units: number): Instruction {
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    data: new Uint8Array([COMPUTE_BUDGET_IX.SetComputeUnitLimit, ...u32le(units)]),
  };
}

export function setComputeUnitPriceInstruction(microLamports: bigint): Instruction {
  return {
    programAddress: COMPUTE_BUDGET_PROGRAM,
    data: new Uint8Array([COMPUTE_BUDGET_IX.SetComputeUnitPrice, ...u64le(microLamports)]),
  };
}

export function readU32le(data: Uint8Array, offset: number): number {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(offset, true);
}

export function readU64le(data: Uint8Array, offset: number): bigint {
  return new DataView(data.buffer, data.byteOffset, data.byteLength).getBigUint64(offset, true);
}

export type { Address, Instruction };
