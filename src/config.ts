// The only place the RPC URL may live. Override via EXPO_PUBLIC_RPC_URL in .env.
export const RPC_URL =
  process.env.EXPO_PUBLIC_RPC_URL ?? 'https://api.mainnet-beta.solana.com';
