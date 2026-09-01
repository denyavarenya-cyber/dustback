import { useMemo, useState } from 'react';
import { Button, FlatList, Pressable, Text, View } from 'react-native';
import { DUST_THRESHOLD_USD } from '../config';
import {
  classifyDust,
  PricedBalance,
  tokenUiAmount,
} from '../core/price';
import { EmptyAccount, totalRecoverableLamports } from '../core/scan';

export interface ResultsProps {
  emptyAccounts: EmptyAccount[];
  priced: PricedBalance[];
  solPriceUsd: number | null;
  onBack: () => void;
}

export function shortenMint(mint: string): string {
  return `${mint.slice(0, 4)}…${mint.slice(-4)}`;
}

function formatUsd(value: number | null): string {
  if (value === null) return '$—';
  if (value === 0 || value >= 0.01) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function formatAmount(value: number): string {
  return value >= 1 ? value.toFixed(2) : value.toPrecision(3);
}

function formatSol(value: number): string {
  return `${value.toFixed(5)} SOL`;
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

export default function ResultsScreen({
  emptyAccounts,
  priced,
  solPriceUsd,
  onBack,
}: ResultsProps) {
  const { dust, noMarket } = useMemo(
    () => classifyDust(priced, DUST_THRESHOLD_USD),
    [priced]
  );
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [includeEmpty, setIncludeEmpty] = useState(true);

  const toggleDust = (pubkey: string) =>
    setExcluded((prev) => {
      const next = new Set(prev);
      if (next.has(pubkey)) next.delete(pubkey);
      else next.add(pubkey);
      return next;
    });

  const rentSol = totalRecoverableLamports(emptyAccounts) / 1e9;
  const rentUsd = solPriceUsd === null ? null : rentSol * solPriceUsd;
  const dustUsd = dust
    .filter((d) => !excluded.has(d.pubkey))
    .reduce((sum, d) => sum + (d.usdValue ?? 0), 0);
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
            {shortenMint(item.mint)}
          </Text>
          <Text style={{ width: 76, textAlign: 'right' }} numberOfLines={1}>
            {formatAmount(tokenUiAmount(item))}
          </Text>
          <Text style={{ width: 64, textAlign: 'right' }}>
            {formatUsd(item.usdValue)}
          </Text>
          <Text style={{ width: 104, textAlign: 'right', color: '#666' }}>
            {item.estimatedSolOut !== undefined
              ? `≈${formatSol(Number(item.estimatedSolOut) / 1e9)}`
              : '—'}
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
          <View style={{ marginTop: 24, marginBottom: 16 }}>
            <Button title="Back to scan" onPress={onBack} />
          </View>
        </View>
      }
    />
  );
}
