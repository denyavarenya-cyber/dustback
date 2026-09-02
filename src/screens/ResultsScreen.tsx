import { useMemo, useState } from 'react';
import { FlatList, Pressable, Text, View } from 'react-native';
import { DUST_THRESHOLD_USD, FEE_BPS } from '../config';
import {
  classifyDust,
  PricedBalance,
  tokenUiAmount,
} from '../core/price';
import { totalRecoverableLamports } from '../core/scan';
import {
  formatAmount,
  formatSol,
  formatUsd,
  shortenAddress,
} from '../format';
import { useSweeperStore } from '../store';
import { useTheme } from '../theme';
import { Btn, Card } from '../ui';

function estimateLabel(item: PricedBalance): string {
  if (item.quoteStatus === 'pending') return '…';
  if (item.quoteStatus === 'skipped') return 'quote at sweep';
  if (item.estimatedSolOut !== undefined) {
    return `≈${formatSol(Number(item.estimatedSolOut) / 1e9)}`;
  }
  return '—';
}

function CheckRow(props: {
  checked: boolean;
  onToggle: () => void;
  children: React.ReactNode;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={props.onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 8 }}
    >
      <Text
        style={{
          fontSize: 18,
          marginRight: 10,
          color: props.checked ? t.accent : t.textSecondary,
        }}
      >
        {props.checked ? '☑' : '☐'}
      </Text>
      {props.children}
    </Pressable>
  );
}

const NO_PRICED: PricedBalance[] = [];

export default function ResultsScreen() {
  const t = useTheme();
  const results = useSweeperStore((s) => s.results);
  const onBack = useSweeperStore((s) => s.reset);
  const quoteProgress = useSweeperStore((s) => s.quoteProgress);
  const wallet = useSweeperStore((s) => s.wallet);
  const startReview = useSweeperStore((s) => s.startReview);
  const priced = results?.priced ?? NO_PRICED;
  const { dust, noMarket } = useMemo(
    () => classifyDust(priced, DUST_THRESHOLD_USD),
    [priced]
  );
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [includeEmpty, setIncludeEmpty] = useState(true);
  const [showRentNote, setShowRentNote] = useState(false);

  if (!results) return null;
  const { emptyAccounts, solPriceUsd } = results;

  const toggleDust = (pubkey: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });

  const selectedEmpty = includeEmpty ? emptyAccounts : [];
  const selectedDust = dust.filter((d) => !excluded.has(d.pubkey));
  const canSweep =
    wallet !== null &&
    wallet.address === results.owner &&
    selectedEmpty.length + selectedDust.length > 0;

  const rentSol = totalRecoverableLamports(emptyAccounts) / 1e9;
  const rentUsd = solPriceUsd === null ? null : rentSol * solPriceUsd;
  const dustUsd = selectedDust.reduce((sum, d) => sum + (d.usdValue ?? 0), 0);
  const totalUsd = dustUsd + (includeEmpty && rentUsd !== null ? rentUsd : 0);

  // pre-review estimate: scan-time quotes, falling back to usd-derived
  const estSwapLamports = selectedDust.reduce((sum, d) => {
    if (d.estimatedSolOut !== undefined) return sum + Number(d.estimatedSolOut);
    if (d.usdValue !== null && solPriceUsd !== null && solPriceUsd > 0) {
      return sum + (d.usdValue / solPriceUsd) * 1e9;
    }
    return sum;
  }, 0);
  const grossLamports =
    totalRecoverableLamports(selectedEmpty) + estSwapLamports;
  const estFeeLamports = Math.floor((grossLamports * FEE_BPS) / 10000);

  return (
    <FlatList
      data={dust}
      keyExtractor={(item) => item.pubkey}
      showsVerticalScrollIndicator={false}
      ListHeaderComponent={
        <View>
          <Text
            style={{ color: t.textSecondary, fontSize: 14, marginTop: 4 }}
          >
            Recoverable
          </Text>
          <Text style={{ color: t.text, fontSize: 44, fontWeight: '700' }}>
            {formatUsd(totalUsd)}
          </Text>

          <Card style={{ marginTop: 16 }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
              Empty token accounts
            </Text>
            {emptyAccounts.length === 0 ? (
              <Text style={{ color: t.textSecondary, paddingVertical: 6 }}>
                None found
              </Text>
            ) : (
              <CheckRow
                checked={includeEmpty}
                onToggle={() => setIncludeEmpty((v) => !v)}
              >
                <Text style={{ color: t.text, flex: 1 }}>
                  {emptyAccounts.length}{' '}
                  {emptyAccounts.length === 1 ? 'account' : 'accounts'} —{' '}
                  {formatSol(rentSol)} ≈ {formatUsd(rentUsd)}
                </Text>
              </CheckRow>
            )}
            <Pressable onPress={() => setShowRentNote((v) => !v)}>
              <Text style={{ color: t.accent, fontSize: 13, marginTop: 4 }}>
                What is rent?
              </Text>
            </Pressable>
            {showRentNote && (
              <Text
                style={{
                  color: t.textSecondary,
                  fontSize: 13,
                  marginTop: 6,
                  lineHeight: 19,
                }}
              >
                Every token account keeps a small SOL deposit (about 0.002 SOL)
                that pays for its storage on Solana. When an account is empty,
                that deposit can be returned to you. DustBack closes only
                accounts with a zero balance — tokens you hold are never
                touched.
              </Text>
            )}
          </Card>

          <Card style={{ marginTop: 12, paddingBottom: 8 }}>
            <Text style={{ color: t.text, fontSize: 16, fontWeight: '600' }}>
              Dust tokens
            </Text>
            {quoteProgress !== null &&
              quoteProgress.done < quoteProgress.total && (
                <Text style={{ color: t.textSecondary, fontSize: 12 }}>
                  Fetching quotes: {quoteProgress.done}/{quoteProgress.total}
                </Text>
              )}
            {dust.length === 0 && (
              <Text style={{ color: t.textSecondary, paddingVertical: 6 }}>
                None found
              </Text>
            )}
          </Card>
        </View>
      }
      renderItem={({ item }) => (
        <Card
          style={{
            marginTop: 6,
            paddingVertical: 2,
            paddingHorizontal: 16,
          }}
        >
          <CheckRow
            checked={!excluded.has(item.pubkey)}
            onToggle={() => toggleDust(item.pubkey)}
          >
            <Text style={{ color: t.text, flex: 1 }} numberOfLines={1}>
              {shortenAddress(item.mint)}
            </Text>
            <Text
              style={{ color: t.text, width: 74, textAlign: 'right' }}
              numberOfLines={1}
            >
              {formatAmount(tokenUiAmount(item))}
            </Text>
            <Text style={{ color: t.text, width: 62, textAlign: 'right' }}>
              {formatUsd(item.usdValue)}
            </Text>
            <Text
              style={{
                color: t.textSecondary,
                width: 100,
                textAlign: 'right',
                fontSize: 12,
              }}
            >
              {estimateLabel(item)}
            </Text>
          </CheckRow>
        </Card>
      )}
      ListFooterComponent={
        <View>
          {noMarket.length > 0 && (
            <Text style={{ color: t.textSecondary, marginTop: 14 }}>
              {noMarket.length}{' '}
              {noMarket.length === 1 ? 'token' : 'tokens'} without a market —
              left untouched
            </Text>
          )}
          {canSweep && grossLamports > 0 && (
            <Text style={{ color: t.text, marginTop: 16, lineHeight: 20 }}>
              You receive{' '}
              <Text style={{ fontWeight: '700' }}>
                {formatSol((grossLamports - estFeeLamports) / 1e9)}
              </Text>{' '}
              after the {FEE_BPS / 100}% fee (
              {formatSol(estFeeLamports / 1e9)}). Exact breakdown next.
            </Text>
          )}
          {canSweep && (
            <Btn
              title="Review sweep"
              onPress={() =>
                startReview({
                  emptyAccounts: selectedEmpty,
                  dustTokens: selectedDust,
                })
              }
              style={{ marginTop: 16 }}
            />
          )}
          <Btn
            title="Back to scan"
            variant="secondary"
            onPress={onBack}
            style={{ marginTop: 12, marginBottom: 16 }}
          />
        </View>
      }
    />
  );
}
