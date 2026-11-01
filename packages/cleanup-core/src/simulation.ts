/** Plain text for a failed simulation. Logs are chain data: shown as text only, never as markup. */
export function explainSimulationError(err: unknown, logs: readonly string[]): string {
  const text = typeof err === 'string' ? err : JSON.stringify(err) ?? '';
  if (text.includes('BlockhashNotFound')) {
    return 'The network moved on before the check finished. Scan again.';
  }
  if (text.includes('InsufficientFundsForFee') || text.includes('AccountNotFound')) {
    return 'The wallet needs a little SOL to pay the network fee.';
  }
  if (text.includes('InsufficientFundsForRent')) {
    return 'An account would fall below the rent minimum. If it is the fee wallet, it must be funded once.';
  }
  const line = logs.find((l) => /error|failed|insufficient/i.test(l));
  const detail = (line ?? text).slice(0, 200);
  return `The transaction would fail on chain: ${detail}`;
}
