import { useMemo, useState } from 'react';
import { Button, FlatList, Pressable, Text, View } from 'react-native';
import { DUST_THRESHOLD_USD } from '../config';
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

function estimateLabel(item: PricedBalance): string {
  if (item.quoteStatus === 'pending') return '…';
  if (item.quoteStatus === 'skipped') return 'est. on sweep';
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
  return (
    <Pressable
      onPress={props.onToggle}
      style={{ flexDirection: 'row', alignItems: 'center', paddingVertical: 6 }}
    >
      <Text style={{ fontSize: 18, marginRight: 8 }}>
        {props.checked ? '☑' : '☐'}
      </Text>
      {props.children}
    </Pressable>
  );
}

const NO_PRICED: PricedBalance[] = [];

export default function ResultsScreen() {
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

  return (
    <FlatList
      data={dust}
      keyExtractor={(item) => item.pubkey}
      ListHeaderComponent={
        <View>
          <Text style={{ fontSize: 14, marginTop: 8 }}>Recoverable</Text>
          <Text style={{ fontSize: 42, fontWeight: 'bold' }}>
            {formatUsd(totalUsd)}
          </Text>

          <Text style={{ fontSize: 16, fontWeight: 'bold', marginTop: 16 }}>
            Empty token accounts
          </Text>
          {emptyAccounts.length === 0 ? (
            <Text style={{ color: '#666', paddingVertical: 6 }}>None</Text>
          ) : (
            <CheckRow
              checked={includeEmpty}
              onToggle={() => setIncludeEmpty((v) => !v)}
            >
              <Text style={{ flex: 1 }}>
                {emptyAccounts.length}{' '}
                {emptyAccounts.length === 1 ? 'account' : 'accounts'} —{' '}
                {formatSol(rentSol)} ≈ {formatUsd(rentUsd)}
              </Text>
            </CheckRow>
          )}

          <Text style={{ fontSize: 16, fontWeight: 'bold', marginTop: 16 }}>
            Dust tokens
          </Text>
          {quoteProgress !== null &&
            quoteProgress.done < quoteProgress.total && (
              <Text style={{ fontSize: 12, color: '#666' }}>
                Fetching quotes: {quoteProgress.done}/{quoteProgress.total}
              </Text>
            )}
          {dust.length === 0 && (
            <Text style={{ color: '#666', paddingVertical: 6 }}>None</Text>
          )}
        </View>
      }
      renderItem={({ item }) => (
        <CheckRow
          checked={!excluded.has(item.pubkey)}
          onToggle={() => toggleDust(item.pubkey)}
        >
          <Text style={{ flex: 1 }} numberOfLines={1}>
            {shortenAddress(item.mint)}
          </Text>
          <Text style={{ width: 76, textAlign: 'right' }} numberOfLines={1}>
            {formatAmount(tokenUiAmount(item))}
          </Text>
          <Text style={{ width: 64, textAlign: 'right' }}>
            {formatUsd(item.usdValue)}
          </Text>
          <Text style={{ width: 104, textAlign: 'right', color: '#666' }}>
            {estimateLabel(item)}
          </Text>
        </CheckRow>
      )}
      ListFooterComponent={
        <View>
          {noMarket.length > 0 && (
            <Text style={{ color: '#666', marginTop: 16 }}>
              {noMarket.length}{' '}
              {noMarket.length === 1 ? 'token' : 'tokens'} without a market
            </Text>
          )}
          {canSweep && (
            <View style={{ marginTop: 24 }}>
              <Button
                title="Sweep"
                onPress={() =>
                  startReview({
                    emptyAccounts: selectedEmpty,
                    dustTokens: selectedDust,
                  })
                }
              />
            </View>
          )}
          <View style={{ marginTop: 24, marginBottom: 16 }}>
            <Button title="Back to scan" onPress={onBack} />
          </View>
        </View>
      }
    />
  );
}
