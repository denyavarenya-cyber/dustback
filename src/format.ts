export function shortenAddress(address: string): string {
  return `${address.slice(0, 4)}…${address.slice(-4)}`;
}

export function tokenLabel(
  mint: string,
  symbols?: Record<string, string>
): string {
  return symbols?.[mint] ?? shortenAddress(mint);
}

export function formatUsd(value: number | null): string {
  if (value === null) return '$—';
  if (value === 0 || value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

export function formatAmount(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toPrecision(3);
}

export function formatSol(value: number): string {
  return `${value.toFixed(5)} SOL`;
}
