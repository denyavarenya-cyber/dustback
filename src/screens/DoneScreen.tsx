import { Button, Linking, ScrollView, Text, View } from 'react-native';
import { formatSol, formatUsd, shortenAddress } from '../format';
import { SweepItemOutcome, useSweeperStore } from '../store';

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'ok',
  failed: 'failed',
  timeout: 'not confirmed',
};

function itemLabel(item: SweepItemOutcome): string {
  if (item.kind === 'swap') {
    return `Swap ${shortenAddress(item.mint)} → ≈${formatSol(
      item.quotedSolOut / 1e9
    )}`;
  }
  if (item.kind === 'closes') {
    return `Close ${item.accounts} ${
      item.accounts === 1 ? 'account' : 'accounts'
    } — ${formatSol(item.rentLamports / 1e9)}${
      item.includesFee ? ' (incl. fee)' : ''
    }`;
  }
  return 'Fee transfer';
}

export default function DoneScreen() {
  const outcome = useSweeperStore((s) => s.outcome);
  const reset = useSweeperStore((s) => s.reset);

  if (!outcome) return null;
  const allOk = outcome.items.every((i) => i.status === 'confirmed');

  return (
    <ScrollView>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginTop: 8 }}>
        {allOk ? 'Sweep complete' : 'Sweep partially complete'}
      </Text>

      <Text style={{ fontSize: 16, marginTop: 16 }}>
        Swapped {outcome.swappedCount} of {outcome.totalSwaps}{' '}
        {outcome.totalSwaps === 1 ? 'token' : 'tokens'}, closed{' '}
        {outcome.closedAccounts} of {outcome.totalAccounts}{' '}
        {outcome.totalAccounts === 1 ? 'account' : 'accounts'}.
      </Text>

      <Text style={{ fontSize: 14, marginTop: 8 }}>
        Recovered ≈{formatSol(Math.max(0, outcome.recoveredLamports) / 1e9)} (~
        {formatUsd(outcome.usdEstimate)})
        {outcome.feeTaken
          ? `, after ${formatSol(outcome.feeLamports / 1e9)} fee`
          : ''}
        . Swap amounts are quoted values; rent is actual.
      </Text>

      <View style={{ marginTop: 16 }}>
        {outcome.items.map((item) => (
          <View key={item.signature} style={{ marginTop: 8 }}>
            <Text style={{ fontSize: 13 }}>
              {itemLabel(item)} —{' '}
              <Text
                style={{
                  color: item.status === 'confirmed' ? '#2a7' : '#c33',
                  fontWeight: 'bold',
                }}
              >
                {STATUS_LABEL[item.status]}
              </Text>
            </Text>
            <Text
              style={{ color: '#36c', fontSize: 12 }}
              onPress={() =>
                Linking.openURL(`https://solscan.io/tx/${item.signature}`)
              }
            >
              solscan.io/tx/{shortenAddress(item.signature)}
            </Text>
          </View>
        ))}
      </View>

      {!allOk && (
        <Text style={{ color: '#666', marginTop: 16, fontSize: 13 }}>
          Failed swaps left the tokens in your wallet — scan again to retry.
        </Text>
      )}

      <View style={{ marginTop: 24, marginBottom: 16 }}>
        <Button title="Scan another wallet" onPress={reset} />
      </View>
    </ScrollView>
  );
}
