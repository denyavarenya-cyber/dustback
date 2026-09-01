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
    return item.signature === ''
      ? `Swap ${shortenAddress(item.mint)} — could not build`
      : `Swap ${shortenAddress(item.mint)} → ≈${formatSol(
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
  const allOk =
    outcome.items.length > 0 &&
    outcome.items.every((i) => i.status === 'confirmed');
  const swapsAllFailed = outcome.totalSwaps > 0 && outcome.swappedCount === 0;
  const nothingHappened = swapsAllFailed && outcome.closedAccounts === 0;

  const header = nothingHappened
    ? 'Sweep failed'
    : allOk
      ? 'Sweep complete'
      : 'Sweep partially complete';

  return (
    <ScrollView>
      <Text
        style={{
          fontSize: 24,
          fontWeight: 'bold',
          marginTop: 8,
          color: nothingHappened ? '#c33' : allOk ? '#2a7' : '#c60',
        }}
      >
        {header}
      </Text>

      {swapsAllFailed && (
        <View
          style={{
            backgroundColor: '#fdd',
            borderColor: '#c33',
            borderWidth: 1,
            borderRadius: 4,
            padding: 12,
            marginTop: 12,
          }}
        >
          <Text style={{ color: '#911', fontWeight: 'bold', fontSize: 16 }}>
            Nothing was swapped
          </Text>
          <Text style={{ color: '#911', marginTop: 4 }}>
            Your tokens are still in the wallet. No swap fee was taken.
          </Text>
        </View>
      )}

      <Text style={{ fontSize: 18, fontWeight: 'bold', marginTop: 16 }}>
        Swapped{' '}
        <Text
          style={{
            color: outcome.swappedCount < outcome.totalSwaps ? '#c33' : '#2a7',
          }}
        >
          {outcome.swappedCount} of {outcome.totalSwaps}
        </Text>{' '}
        {outcome.totalSwaps === 1 ? 'token' : 'tokens'}, closed{' '}
        <Text
          style={{
            color:
              outcome.closedAccounts < outcome.totalAccounts
                ? '#c33'
                : '#2a7',
          }}
        >
          {outcome.closedAccounts} of {outcome.totalAccounts}
        </Text>{' '}
        {outcome.totalAccounts === 1 ? 'account' : 'accounts'}.
      </Text>

      <Text style={{ fontSize: 14, marginTop: 8 }}>
        Recovered ≈{formatSol(Math.max(0, outcome.recoveredLamports) / 1e9)} (~
        {formatUsd(outcome.usdEstimate)}). Swap amounts are quoted values; rent
        is actual.
      </Text>

      <Text style={{ fontSize: 14, marginTop: 4, fontWeight: 'bold' }}>
        {outcome.feeTaken
          ? `Fee taken: ${formatSol(
              outcome.feeLamports / 1e9
            )} — on delivered value only.`
          : 'No fee was taken.'}
      </Text>

      {outcome.feePhaseError !== null && (
        <Text style={{ color: '#c33', marginTop: 8 }}>
          Closing accounts / fee step did not run: {outcome.feePhaseError}
        </Text>
      )}

      <View style={{ marginTop: 16 }}>
        {outcome.items.map((item, index) => (
          <View key={`${item.signature}-${index}`} style={{ marginTop: 8 }}>
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
            {item.signature !== '' && (
              <Text
                style={{ color: '#36c', fontSize: 12 }}
                onPress={() =>
                  Linking.openURL(`https://solscan.io/tx/${item.signature}`)
                }
              >
                solscan.io/tx/{shortenAddress(item.signature)}
              </Text>
            )}
          </View>
        ))}
      </View>

      {swapsAllFailed && (
        <Text style={{ color: '#666', marginTop: 16, fontSize: 13 }}>
          Scan again to retry — failed swaps left the tokens untouched.
        </Text>
      )}

      <View style={{ marginTop: 24, marginBottom: 16 }}>
        <Button title="Scan another wallet" onPress={reset} />
      </View>
    </ScrollView>
  );
}
