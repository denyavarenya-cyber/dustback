export type CleanupErrorCode =
  | 'FEATURE_DISABLED'
  | 'FEE_WALLET_NOT_SET'
  | 'MAINNET_BLOCKED'
  | 'CLUSTER_MISMATCH'
  | 'INVALID_CONFIG'
  | 'INVALID_ADDRESS'
  | 'STALE_SCAN'
  | 'NOT_IN_SCAN'
  | 'NOT_CLOSABLE'
  | 'PROTECTED'
  | 'BURN_REFUSED'
  | 'NOT_SWAPPABLE'
  | 'RPC_ERROR'
  | 'RATE_LIMITED'
  | 'ALREADY_SENT'
  | 'BAD_RESPONSE'
  | 'UNSAFE_TRANSACTION'
  | 'FEE_ACCOUNT_INVALID'
  | 'TOO_LARGE'
  | 'SIMULATION_FAILED';

export class CleanupError extends Error {
  readonly code: CleanupErrorCode;
  readonly details: unknown;

  constructor(code: CleanupErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'CleanupError';
    this.code = code;
    this.details = details;
  }
}

export function isCleanupError(e: unknown, code?: CleanupErrorCode): e is CleanupError {
  return e instanceof CleanupError && (code === undefined || e.code === code);
}
