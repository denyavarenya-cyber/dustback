import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  getAddressEncoder,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
} from '@solana/kit';
import { type CleanupConfig, type ConfigOverrides, createConfig } from '../src/config';
import { GENESIS_HASH } from '../src/constants';
import type { RpcTransport } from '../src/rpc';
import { classifyEntries, type ScanResult } from '../src/scan';
import { staticPriceSource } from '../src/prices';

const FIXTURES = fileURLToPath(new URL('./fixtures', import.meta.url));

export function fixture<T = unknown>(name: string): T {
  return JSON.parse(readFileSync(join(FIXTURES, name), 'utf8')) as T;
}

export interface Addresses {
  owner: string;
  feeWallet: string;
  feeAccount: string;
  userWsolAta: string;
  swapMint: string;
  swapInput: string;
  usdcAccount: string;
  wsolAccount: string;
  lookupTable: string;
  pools: string[];
  stranger: string;
}

export const ADDR = fixture<Addresses>('addresses.json');

interface WalletFixture {
  owner: string;
  token: unknown[];
  token2022: unknown[];
  prices: Record<string, number>;
}

export const NOW = new Date('2026-10-31T12:00:00.000Z');

export function testConfig(overrides: ConfigOverrides = {}): CleanupConfig {
  return createConfig({ feeWallet: ADDR.feeWallet, swapFeeTokenAccount: ADDR.feeAccount, ...overrides });
}

export async function scanFixture(name: string, config: CleanupConfig = testConfig()): Promise<ScanResult> {
  const w = fixture<WalletFixture>(name);
  return classifyEntries({
    owner: w.owner,
    cluster: config.cluster,
    entries: { token: w.token, token2022: w.token2022 },
    prices: staticPriceSource(w.prices),
    config,
    now: NOW,
  });
}

export function walletEntries(name: string): WalletFixture {
  return fixture<WalletFixture>(name);
}

// ---- fake RPC from recorded responses ----

export type Handler = (params: readonly unknown[]) => unknown;

export interface FakeRpc {
  transport: RpcTransport;
  calls: { method: string; params: readonly unknown[] }[];
}

export function fakeRpc(handlers: Record<string, Handler>): FakeRpc {
  const calls: FakeRpc['calls'] = [];
  const transport: RpcTransport = async (method, params) => {
    calls.push({ method, params });
    const h = handlers[method];
    if (h === undefined) throw new Error(`unexpected RPC call ${method}`);
    return structuredClone(h(params));
  };
  return { transport, calls };
}

export const BLOCKHASH = '9xQeWvG816bUx9EPjHmaT23yvVM2ZWbrrpZb9PusVFin';

export const baseHandlers: Record<string, Handler> = {
  getGenesisHash: () => GENESIS_HASH.devnet,
  getLatestBlockhash: () => ({ context: { slot: 1 }, value: { blockhash: BLOCKHASH, lastValidBlockHeight: 1150 } }),
};

export function simOk(unitsConsumed = 12_345, accounts: unknown[] | null = null) {
  return {
    context: { slot: 2 },
    value: { err: null, logs: ['Program log: ok'], accounts, unitsConsumed, returnData: null },
  };
}

export function simErr(err: unknown, logs: string[] = []) {
  return { context: { slot: 2 }, value: { err, logs, accounts: null, unitsConsumed: 0, returnData: null } };
}

// ---- account data helpers ----

const addressEncoder = getAddressEncoder();
const b64 = getBase64Encoder();

export function tokenAccountData(mint: string, owner: string, amount: bigint): string {
  const data = new Uint8Array(165);
  data.set(addressEncoder.encode(mint as never), 0);
  data.set(addressEncoder.encode(owner as never), 32);
  new DataView(data.buffer).setBigUint64(64, amount, true);
  data[108] = 1; // initialized
  return Buffer.from(data).toString('base64');
}

export function rawAccount(lamports: number, owner: string, dataBase64 = '') {
  return { data: [dataBase64, 'base64'], executable: false, lamports, owner, rentEpoch: 0, space: 0 };
}

// ---- transaction decoding for assertions ----

export interface DecodedInstruction {
  program: string;
  accounts: string[];
  writable: boolean[];
  signer: boolean[];
  data: number[];
}

export interface DecodedTransaction {
  version: string | number;
  feePayer: string;
  signers: number;
  instructions: DecodedInstruction[];
  bytes: number;
}

export function decodeTx(base64: string, tables: Record<string, string[]> = {}): DecodedTransaction {
  const bytes = new Uint8Array(b64.encode(base64));
  const tx = getTransactionDecoder().decode(bytes);
  // Legacy and v0 messages only; this module never builds v1.
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
    version: string | number;
    header: { numSignerAccounts: number; numReadonlySignerAccounts: number; numReadonlyNonSignerAccounts: number };
    staticAccounts: string[];
    instructions: { programAddressIndex: number; accountIndices?: number[]; data?: Uint8Array }[];
    addressTableLookups?: { lookupTableAddress: string; writableIndexes?: number[]; readonlyIndexes?: number[] }[];
  };
  const h = msg.header;
  const statics = msg.staticAccounts.map(String);
  const lookups = 'addressTableLookups' in msg && msg.addressTableLookups ? msg.addressTableLookups : [];
  const loadedW: string[] = [];
  const loadedR: string[] = [];
  for (const l of lookups) {
    const table = tables[String(l.lookupTableAddress)] ?? [];
    for (const i of l.writableIndexes ?? []) loadedW.push(table[i] ?? '?');
    for (const i of l.readonlyIndexes ?? []) loadedR.push(table[i] ?? '?');
  }
  const all = [...statics, ...loadedW, ...loadedR];
  const nSig = h.numSignerAccounts;
  const isWritable = (i: number): boolean => {
    if (i < statics.length) {
      if (i < nSig) return i < nSig - h.numReadonlySignerAccounts;
      return i < statics.length - h.numReadonlyNonSignerAccounts;
    }
    return i < statics.length + loadedW.length;
  };
  return {
    version: msg.version,
    feePayer: statics[0] ?? '',
    signers: nSig,
    bytes: bytes.length,
    instructions: msg.instructions.map((ix) => {
      const idx = ix.accountIndices ?? [];
      return {
        program: all[ix.programAddressIndex] ?? '?',
        accounts: idx.map((i) => all[i] ?? '?'),
        writable: idx.map(isWritable),
        signer: idx.map((i) => i < nSig),
        data: [...(ix.data ?? [])],
      };
    }),
  };
}

export function u64At(data: number[], offset: number): bigint {
  return new DataView(new Uint8Array(data).buffer).getBigUint64(offset, true);
}
