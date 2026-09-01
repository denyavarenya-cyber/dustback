import { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  Pressable,
  ScrollView,
  Text,
  View,
} from 'react-native';
import { FEE_BPS } from '../config';
import { tokenUiAmount } from '../core/price';
import {
  formatAmount,
  formatSol,
  formatUsd,
  shortenAddress,
} from '../format';
import { useSweeperStore } from '../store';

const SIGNATURE_FEE_LAMPORTS = 5000;

export default function ReviewScreen() {
  const plan = useSweeperStore((s) => s.plan);
  const planning = useSweeperStore((s) => s.planning);
  const executing = useSweeperStore((s) => s.executing);
  const confirming = useSweeperStore((s) => s.confirming);
  const sweepError = useSweeperStore((s) => s.sweepError);
  const cancelReview = useSweeperStore((s) => s.cancelReview);
  const confirmSweep = useSweeperStore((s) => s.confirmSweep);
  const [showDetails, setShowDetails] = useState(false);

  const busy = executing || confirming;
  const summary = plan?.summary;

  return (
    <ScrollView>
      <Text style={{ fontSize: 24, fontWeight: 'bold', marginTop: 8 }}>
        Review
      </Text>

      {planning && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}
        >
          <ActivityIndicator />
          <Text style={{ marginLeft: 8 }}>Fetching quotes…</Text>
        </View>
      )}

      {summary && (
        <View style={{ marginTop: 16 }}>
          <Text style={{ fontSize: 16 }}>
            Close {summary.accountsClosed} empty{' '}
            {summary.accountsClosed === 1 ? 'account' : 'accounts'}, swap{' '}
            {summary.tokensSwapped} dust{' '}
            {summary.tokensSwapped === 1 ? 'token' : 'tokens'} to SOL. You
            receive {formatSol(summary.userReceivesLamports / 1e9)} (~
            {formatUsd(summary.usdEstimate)}). Fee:{' '}
            {formatSol(summary.feeLamports / 1e9)} ({FEE_BPS / 100}%).
          </Text>

          {plan.skippedTokens.length > 0 && (
            <Text style={{ color: '#666', marginTop: 8 }}>
              {plan.skippedTokens.length}{' '}
              {plan.skippedTokens.length === 1 ? 'token' : 'tokens'} skipped
              (no quote available)
            </Text>
          )}

          <Pressable onPress={() => setShowDetails((v) => !v)}>
            <Text style={{ color: '#36c', marginTop: 16 }}>
              {showDetails ? 'Hide details' : 'Show details'}
            </Text>
          </Pressable>

          {showDetails && (
            <View style={{ marginTop: 8 }}>
              {plan.transactions.map((t, i) => {
                if (t.kind === 'swap') {
                  return (
                    <Text key={i} style={{ fontSize: 13, marginTop: 4 }}>
                      Swap {shortenAddress(t.mint)} —{' '}
                      {formatAmount(
                        tokenUiAmount({
                          pubkey: t.pubkey,
                          mint: t.mint,
                          program: 'token',
                          amountRaw: t.amountRaw,
                          decimals: t.decimals,
                        })
                      )}{' '}
                      → ≈{formatSol(t.quotedSolOut / 1e9)}
                    </Text>
                  );
                }
                if (t.kind === 'closes') {
                  return (
                    <View key={i}>
                      {t.emptyAccounts.map((a) => (
                        <Text
                          key={a.pubkey}
                          style={{ fontSize: 13, marginTop: 4 }}
                        >
                          Close {shortenAddress(a.pubkey)} — rent{' '}
                          {formatSol(a.lamports / 1e9)}
                        </Text>
                      ))}
                    </View>
                  );
                }
                return null;
              })}
              <Text style={{ fontSize: 13, marginTop: 4 }}>
                Fee ({FEE_BPS / 100}%) — {formatSol(summary.feeLamports / 1e9)}
              </Text>
              <Text style={{ fontSize: 13, marginTop: 4, color: '#666' }}>
                Network fees — ~
                {formatSol(
                  (plan.transactions.length * SIGNATURE_FEE_LAMPORTS) / 1e9
                )}
              </Text>
            </View>
          )}

          <View style={{ marginTop: 24 }}>
            <Button
              title="Confirm sweep"
              onPress={confirmSweep}
              disabled={busy || plan.transactions.length === 0}
            />
          </View>
        </View>
      )}

      {executing && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}
        >
          <ActivityIndicator />
          <Text style={{ marginLeft: 8 }}>Waiting for wallet…</Text>
        </View>
      )}
      {confirming && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}
        >
          <ActivityIndicator />
          <Text style={{ marginLeft: 8 }}>Confirming…</Text>
        </View>
      )}
      {sweepError && (
        <Text style={{ color: 'red', marginTop: 16 }}>{sweepError}</Text>
      )}

      <View style={{ marginTop: 24, marginBottom: 16 }}>
        <Button title="Back" onPress={cancelReview} disabled={busy} />
      </View>
    </ScrollView>
  );
}
