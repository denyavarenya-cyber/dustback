import { useState } from 'react';
import {
  ActivityIndicator,
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
import { useTheme } from '../theme';
import { Btn, Card } from '../ui';

const SIGNATURE_FEE_LAMPORTS = 5000;

export default function ReviewScreen() {
  const t = useTheme();
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
    <ScrollView showsVerticalScrollIndicator={false}>
      <Text style={{ color: t.text, fontSize: 26, fontWeight: '700' }}>
        Review before signing
      </Text>

      {planning && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 20 }}
        >
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.textSecondary, marginLeft: 10 }}>
            Fetching fresh quotes…
          </Text>
        </View>
      )}

      {summary && (
        <View style={{ marginTop: 16 }}>
          <Card>
            <Text style={{ color: t.text, fontSize: 16, lineHeight: 24 }}>
              Close {summary.accountsClosed} empty{' '}
              {summary.accountsClosed === 1 ? 'account' : 'accounts'}, swap{' '}
              {summary.tokensSwapped} dust{' '}
              {summary.tokensSwapped === 1 ? 'token' : 'tokens'} to SOL. You
              receive{' '}
              <Text style={{ fontWeight: '700' }}>
                {formatSol(summary.userReceivesLamports / 1e9)}
              </Text>{' '}
              (~{formatUsd(summary.usdEstimate)}). Fee:{' '}
              {formatSol(summary.feeLamports / 1e9)} ({FEE_BPS / 100}%).
            </Text>
          </Card>

          {plan.skippedTokens.length > 0 && (
            <Text style={{ color: t.textSecondary, marginTop: 10 }}>
              {plan.skippedTokens.length}{' '}
              {plan.skippedTokens.length === 1 ? 'token' : 'tokens'} skipped
              (no quote available)
            </Text>
          )}

          <Pressable onPress={() => setShowDetails((v) => !v)}>
            <Text style={{ color: t.accent, marginTop: 16 }}>
              {showDetails ? 'Hide instructions' : 'Show every instruction'}
            </Text>
          </Pressable>

          {showDetails && (
            <Card style={{ marginTop: 8 }}>
              {plan.transactions.map((item, i) => {
                if (item.kind === 'swap') {
                  return (
                    <Text
                      key={i}
                      style={{ color: t.text, fontSize: 13, marginTop: 4 }}
                    >
                      Swap {shortenAddress(item.mint)} —{' '}
                      {formatAmount(
                        tokenUiAmount({
                          pubkey: item.pubkey,
                          mint: item.mint,
                          program: 'token',
                          amountRaw: item.amountRaw,
                          decimals: item.decimals,
                        })
                      )}{' '}
                      → ≈{formatSol(item.quotedSolOut / 1e9)}
                    </Text>
                  );
                }
                if (item.kind === 'closes') {
                  return (
                    <View key={i}>
                      {item.emptyAccounts.map((a) => (
                        <Text
                          key={a.pubkey}
                          style={{ color: t.text, fontSize: 13, marginTop: 4 }}
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
              <Text style={{ color: t.text, fontSize: 13, marginTop: 4 }}>
                Fee ({FEE_BPS / 100}%) — {formatSol(summary.feeLamports / 1e9)}
              </Text>
              <Text
                style={{ color: t.textSecondary, fontSize: 13, marginTop: 4 }}
              >
                Network fees — ~
                {formatSol(
                  (plan.transactions.length * SIGNATURE_FEE_LAMPORTS) / 1e9
                )}
              </Text>
            </Card>
          )}

          {summary.tokensSwapped > 0 && (
            <Text
              style={{ color: t.textSecondary, marginTop: 14, fontSize: 13 }}
            >
              You will sign twice: swaps first, then{' '}
              {summary.accountsClosed > 0 ? 'account closes and ' : ''}the fee
              — charged only on swaps that actually completed.
            </Text>
          )}

          <Text
            style={{
              color: t.textSecondary,
              marginTop: 14,
              fontSize: 13,
              lineHeight: 19,
            }}
          >
            This sweep only closes the accounts and swaps the tokens listed
            above. It never requests approvals, delegates or any other
            permission. The fee is only charged on swaps that complete.
          </Text>

          <Btn
            title="Confirm and sign in wallet"
            onPress={confirmSweep}
            disabled={busy || plan.transactions.length === 0}
            style={{ marginTop: 20 }}
          />
        </View>
      )}

      {executing && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}
        >
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.textSecondary, marginLeft: 10 }}>
            Waiting for wallet…
          </Text>
        </View>
      )}
      {confirming && (
        <View
          style={{ flexDirection: 'row', alignItems: 'center', marginTop: 16 }}
        >
          <ActivityIndicator color={t.accent} />
          <Text style={{ color: t.textSecondary, marginLeft: 10 }}>
            Confirming on-chain…
          </Text>
        </View>
      )}
      {sweepError && (
        <Card tint="danger" style={{ marginTop: 16 }}>
          <Text style={{ color: t.danger }}>{sweepError}</Text>
        </Card>
      )}

      <Btn
        title="Back"
        variant="secondary"
        onPress={cancelReview}
        disabled={busy}
        style={{ marginTop: 16, marginBottom: 16 }}
      />
    </ScrollView>
  );
}
