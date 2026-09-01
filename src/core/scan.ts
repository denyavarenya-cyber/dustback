import {
  AccountInfo,
  Connection,
  ParsedAccountData,
  PublicKey,
} from '@solana/web3.js';

export const TOKEN_PROGRAM_ID = new PublicKey(
  'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA'
);
export const TOKEN_2022_PROGRAM_ID = new PublicKey(
  'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb'
);

export type TokenProgram = 'token' | 'token2022';

export interface EmptyAccount {
  pubkey: string;
  program: TokenProgram;
  /** Actual rent deposit on the account; varies with Token-2022 extensions. */
  lamports: number;
}

export interface TokenBalance {
  pubkey: string;
  mint: string;
  program: TokenProgram;
  amountRaw: string;
  decimals: number;
}

export interface ScanResult {
  emptyAccounts: EmptyAccount[];
  nonEmptyAccounts: TokenBalance[];
}

const PARSED_PROGRAM_NAMES: Record<TokenProgram, string> = {
  token: 'spl-token',
  token2022: 'spl-token-2022',
};

type ParsedTokenAccount = {
  pubkey: PublicKey;
  account: AccountInfo<ParsedAccountData>;
};

export async function scanWallet(
  connection: Connection,
  owner: PublicKey
): Promise<ScanResult> {
  // getParsedTokenAccountsByOwner = getTokenAccountsByOwner with jsonParsed encoding
  const [legacy, token2022] = await Promise.all([
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID,
    }),
    connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_2022_PROGRAM_ID,
    }),
  ]);

  const result: ScanResult = { emptyAccounts: [], nonEmptyAccounts: [] };
  classify(legacy.value, 'token', result);
  classify(token2022.value, 'token2022', result);
  return result;
}

function classify(
  accounts: ParsedTokenAccount[],
  program: TokenProgram,
  out: ScanResult
): void {
  for (const { pubkey, account } of accounts) {
    const { data } = account;
    if (data.program !== PARSED_PROGRAM_NAMES[program]) continue;
    if (data.parsed?.type !== 'account') continue;

    const info = data.parsed.info;
    const amount = info?.tokenAmount?.amount;
    if (typeof amount !== 'string') continue;

    if (amount === '0') {
      out.emptyAccounts.push({
        pubkey: pubkey.toBase58(),
        program,
        lamports: account.lamports,
      });
    } else {
      out.nonEmptyAccounts.push({
        pubkey: pubkey.toBase58(),
        mint: info.mint,
        program,
        amountRaw: amount,
        decimals: info.tokenAmount.decimals,
      });
    }
  }
}

export function totalRecoverableLamports(
  emptyAccounts: EmptyAccount[]
): number {
  return emptyAccounts.reduce((sum, account) => sum + account.lamports, 0);
}
