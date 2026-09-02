import * as Sharing from 'expo-sharing';
import { useRef } from 'react';
import { Linking, ScrollView, Text, View } from 'react-native';
import { captureRef } from 'react-native-view-shot';
import {
  formatSol,
  formatUsd,
  shortenAddress,
  tokenLabel,
} from '../format';
import { SweepItemOutcome, useSweeperStore } from '../store';
import { useTheme } from '../theme';
import { Btn, Card } from '../ui';
import ShareCard from './ShareCard';

const STATUS_LABEL: Record<string, string> = {
  confirmed: 'ok',
  failed: 'failed',
  timeout: 'not confirmed',
};

function itemLabel(
  item: SweepItemOutcome,
  symbols?: Record<string, string>
): string {
  if (item.kind === 'swap') {
    const label = tokenLabel(item.mint, symbols);
    if (item.signature === '') {
      return `Swap ${label} — no quote available`;
    }
    return item.status === 'confirmed'
      ? `Swap ${label} → ${formatSol(item.quotedSolOut / 1e9)}`
      : `Swap ${label} → ≈${formatSol(item.quotedSolOut / 1e9)} (quoted)`;
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
  const t = useTheme();
  const outcome = useSweeperStore((s) => s.outcome);
  const reset = useSweeperStore((s) => s.reset);
  const symbols = useSweeperStore((s) => s.results?.symbols);
  const cardRef = useRef<View>(null);

  if (!outcome) return null;

  const shareResult = async () => {
    try {
      const uri = await captureRef(cardRef, { format: 'png', quality: 1 });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(uri, { mimeType: 'image/png' });
      }
    } catch {
      // share sheet declined or capture failed: nothing to do
    }
  };
  const allOk =
    outcome.items.length > 0 &&
    outcome.items.every((i) => i.status === 'confirmed');
  const swapsAllFailed = outcome.totalSwaps > 0 && outcome.swappedCount === 0;
  const nothingHappened = swapsAllFailed && outcome.closedAccounts === 0;

  return (
    <ScrollView showsVerticalScrollIndicator={false}>
      {nothingHappened ? (
        <Card tint="danger">
          <Text style={{ color: t.danger, fontSize: 22, fontWeight: '700' }}>
            Sweep failed
          </Text>
          <Text style={{ color: t.danger, marginTop: 6, lineHeight: 20 }}>
            Nothing was swapped. Your tokens are still in the wallet. No fee
            was taken.
          </Text>
        </Card>
      ) : (
        <Card tint="success">
          <Text style={{ color: t.textSecondary, fontSize: 14 }}>
            Recovered
          </Text>
          <Text style={{ color: t.accent, fontSize: 40, fontWeight: '700' }}>
            {formatSol(Math.max(0, outcome.recoveredLamports) / 1e9)}
          </Text>
          <Text style={{ color: t.textSecondary, fontSize: 15 }}>
            ~{formatUsd(outcome.usdEstimate)} returned to your wallet
          </Text>
        </Card>
      )}

      {swapsAllFailed && !nothingHappened && (
        <Card tint="danger" style={{ marginTop: 12 }}>
          <Text style={{ color: t.danger, fontWeight: '700', fontSize: 15 }}>
            Nothing was swapped
          </Text>
          <Text style={{ color: t.danger, marginTop: 4 }}>
            Your tokens are still in the wallet. No swap fee was taken.
          </Text>
        </Card>
      )}

      <Text
        style={{
          color: t.text,
          fontSize: 17,
          fontWeight: '600',
          marginTop: 18,
        }}
      >
        Swapped{' '}
        <Text
          style={{
            color:
              outcome.swappedCount < outcome.totalSwaps ? t.danger : t.accent,
          }}
        >
          {outcome.swappedCount} of {outcome.totalSwaps}
        </Text>{' '}
        {outcome.totalSwaps === 1 ? 'token' : 'tokens'}, closed{' '}
        <Text
          style={{
            color:
              outcome.closedAccounts < outcome.totalAccounts
                ? t.danger
                : t.accent,
          }}
        >
          {outcome.closedAccounts} of {outcome.totalAccounts}
        </Text>{' '}
        {outcome.totalAccounts === 1 ? 'account' : 'accounts'}.
      </Text>

      <Text
        style={{
          color: t.text,
          fontSize: 14,
          marginTop: 6,
          fontWeight: '700',
        }}
      >
        {outcome.feeTaken
          ? `Fee taken: ${formatSol(
              outcome.feeLamports / 1e9
            )} — on delivered value only.`
          : 'No fee was taken.'}
      </Text>

      {outcome.feePhaseError !== null && (
        <Text style={{ color: t.danger, marginTop: 8 }}>
          Account closes and fee were not sent: {outcome.feePhaseError}
        </Text>
      )}

      <Card style={{ marginTop: 16 }}>
        {outcome.items.map((item, index) => (
          <View
            key={`${item.signature}-${index}`}
            style={{ marginTop: index === 0 ? 0 : 10 }}
          >
            <Text style={{ color: t.text, fontSize: 13 }}>
              <Text
                style={{
                  color: item.status === 'confirmed' ? t.accent : t.danger,
                  fontWeight: '700',
                }}
              >
                {item.status === 'confirmed' ? '✓' : '✕'}
              </Text>{' '}
              {itemLabel(item, symbols)} —{' '}
              <Text
                style={{
                  color: item.status === 'confirmed' ? t.accent : t.danger,
                }}
              >
                {STATUS_LABEL[item.status]}
              </Text>
            </Text>
            {item.signature !== '' && (
              <Text
                style={{ color: t.accent, fontSize: 12, marginTop: 2 }}
                onPress={() =>
                  Linking.openURL(`https://solscan.io/tx/${item.signature}`)
                }
              >
                solscan.io/tx/{shortenAddress(item.signature)}
              </Text>
            )}
          </View>
        ))}
      </Card>

      {swapsAllFailed && (
        <Text style={{ color: t.textSecondary, marginTop: 14, fontSize: 13 }}>
          Scan again to retry — failed swaps left the tokens untouched.
        </Text>
      )}

      {outcome.recoveredLamports > 0 && (
        <Btn
          title="Share result"
          onPress={shareResult}
          style={{ marginTop: 20 }}
        />
      )}
      <Btn
        title="Scan another wallet"
        variant="secondary"
        onPress={reset}
        style={{ marginTop: 12, marginBottom: 16 }}
      />

      <ShareCard
        ref={cardRef}
        usd={formatUsd(outcome.usdEstimate)}
        accountsClosed={outcome.closedAccounts}
        netSol={formatSol(Math.max(0, outcome.recoveredLamports) / 1e9)}
      />
    </ScrollView>
  );
}
