// The only place the RPC URL may live. Override via EXPO_PUBLIC_RPC_URL in .env.
export const RPC_URL =
  process.env.EXPO_PUBLIC_RPC_URL ?? 'https://api.mainnet-beta.solana.com';

// Balances worth less than this are dust. User-adjustable later.
export const DUST_THRESHOLD_USD = 5;
