import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { Connection, PublicKey } from '@solana/web3.js';
import { RPC_URL } from './src/config';
import { getSolPriceUsd, PricedBalance, priceTokens } from './src/core/price';
import { EmptyAccount, scanWallet } from './src/core/scan';
import ResultsScreen from './src/screens/ResultsScreen';

interface Results {
  emptyAccounts: EmptyAccount[];
  priced: PricedBalance[];
  solPriceUsd: number | null;
}

export default function App() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<Results | null>(null);

  const onScan = async () => {
    setError(null);

    let owner: PublicKey;
    try {
      owner = new PublicKey(address.trim());
    } catch {
      setError('Invalid wallet address');
      return;
    }

    setLoading(true);
    try {
      const connection = new Connection(RPC_URL, 'confirmed');
      const scan = await scanWallet(connection, owner);
      const priced = await priceTokens(scan.nonEmptyAccounts);
      const solPriceUsd = await getSolPriceUsd();
      setResults({ emptyAccounts: scan.emptyAccounts, priced, solPriceUsd });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        {results ? (
          <ResultsScreen
            emptyAccounts={results.emptyAccounts}
            priced={results.priced}
            solPriceUsd={results.solPriceUsd}
            onBack={() => setResults(null)}
          />
        ) : (
          <>
            <TextInput
              value={address}
              onChangeText={setAddress}
              placeholder="Wallet address"
              autoCapitalize="none"
              autoCorrect={false}
              style={{ borderWidth: 1, padding: 8, marginBottom: 8 }}
            />
            <Button title="Scan" onPress={onScan} disabled={loading} />
            {loading && <ActivityIndicator style={{ marginTop: 16 }} />}
            {error && (
              <Text style={{ color: 'red', marginTop: 16 }}>{error}</Text>
            )}
          </>
        )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
