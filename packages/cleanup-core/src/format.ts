const LAMPORTS_PER_SOL = 1_000_000_000n;

/**
 * Exact decimal SOL text from lamports, no floating point. Trailing zeros are
 * trimmed down to `minDecimals`.
 */
export function formatSol(lamports: bigint, minDecimals = 4): string {
  const negative = lamports < 0n;
  const abs = negative ? -lamports : lamports;
  const whole = abs / LAMPORTS_PER_SOL;
  let frac = (abs % LAMPORTS_PER_SOL).toString().padStart(9, '0');
  while (frac.length > minDecimals && frac.endsWith('0')) frac = frac.slice(0, -1);
  const text = frac.length > 0 ? `${whole}.${frac}` : `${whole}`;
  return negative ? `-${text}` : text;
}

/** Exact decimal text of a raw token amount. */
export function formatTokenAmount(amountRaw: bigint, decimals: number): string {
  if (decimals === 0) return amountRaw.toString();
  const s = amountRaw.toString().padStart(decimals + 1, '0');
  const whole = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, '');
  return frac === '' ? whole : `${whole}.${frac}`;
}

/** First and last characters of an address or signature, for compact rows. */
export function shorten(value: string, keep = 4): string {
  return value.length <= keep * 2 + 1 ? value : `${value.slice(0, keep)}…${value.slice(-keep)}`;
}
