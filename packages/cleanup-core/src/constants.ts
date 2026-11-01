import { address } from '@solana/kit';

export const SYSTEM_PROGRAM = address('11111111111111111111111111111111');
export const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
export const TOKEN_2022_PROGRAM = address('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM = address('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
export const COMPUTE_BUDGET_PROGRAM = address('ComputeBudget111111111111111111111111111111');
export const ADDRESS_LOOKUP_TABLE_PROGRAM = address('AddressLookupTab1e1111111111111111111111111');
export const WSOL_MINT = address('So11111111111111111111111111111111111111112');

/** Jupiter Aggregator program; the V2 routing instructions live in it. */
export const JUPITER_AGGREGATOR_PROGRAM = 'JUP6LkbZbjS1jKKwapdHNy74zcZ3tLUZoi5QNyVTaV4';

/** Genesis hashes, used to prove which cluster an RPC endpoint serves. */
export const GENESIS_HASH = {
  'mainnet-beta': '5eykt4UsFv8P8NJdTREpY1vzqKqZKvdpKuc147dw2N9d',
  devnet: 'EtWTRABZaYq6iMfeYKouRu166VU2xqa1wcaWoxPkrZBG',
} as const;

/** Base fee per signature; every transaction here has exactly one signer. */
export const LAMPORTS_PER_SIGNATURE = 5000n;
export const MAX_COMPUTE_UNIT_LIMIT = 1_400_000;

/** Instruction discriminators shared by the Token and Token-2022 programs. */
export const TOKEN_IX = {
  Transfer: 3,
  Approve: 4,
  SetAuthority: 6,
  Burn: 8,
  CloseAccount: 9,
  TransferChecked: 12,
  ApproveChecked: 13,
  BurnChecked: 15,
  SyncNative: 17,
  TransferFeeExtension: 26,
} as const;

/** Sub instruction of TransferFeeExtension; permissionless. */
export const HARVEST_WITHHELD_TOKENS_TO_MINT = 4;

export const SYSTEM_IX_TRANSFER = 2;

export const COMPUTE_BUDGET_IX = {
  RequestHeapFrame: 1,
  SetComputeUnitLimit: 2,
  SetComputeUnitPrice: 3,
  SetLoadedAccountsDataSizeLimit: 4,
} as const;

export const ATA_IX = { Create: 0, CreateIdempotent: 1 } as const;

/** Size of the address lookup table header before the address list. */
export const LOOKUP_TABLE_META_SIZE = 56;
export const U64_MAX = 18_446_744_073_709_551_615n;
