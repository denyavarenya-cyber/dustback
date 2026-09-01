import { StatusBar } from 'expo-status-bar';
import { useState } from 'react';
import {
  ActivityIndicator,
  Button,
  FlatList,
  Text,
  TextInput,
  View,
} from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { Connection, PublicKey } from '@solana/web3.js';
import { RPC_URL } from './src/config';
import { scanWallet, ScanResult, totalRecoverableLamports } from './src/core/scan';

export default function App() {
  const [address, setAddress] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);

  const onScan = async () => {
    setError(null);
    setResult(null);

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
      setResult(await scanWallet(connection, owner));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Scan failed');
    } finally {
      setLoading(false);
    }
  };

  const totalSol = result
    ? (totalRecoverableLamports(result.emptyAccounts) / 1e9).toFixed(6)
    : null;

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
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
        {error && <Text style={{ color: 'red', marginTop: 16 }}>{error}</Text>}
        {result && (
          <View style={{ flex: 1, marginTop: 16 }}>
            <Text>Empty accounts: {result.emptyAccounts.length}</Text>
            <Text>Recoverable: {totalSol} SOL</Text>
            <Text>Non-empty accounts: {result.nonEmptyAccounts.length}</Text>
            <FlatList
              data={result.emptyAccounts}
              keyExtractor={(item) => item.pubkey}
              renderItem={({ item }) => (
                <Text style={{ fontSize: 12, marginTop: 4 }}>
                  {item.pubkey} — {item.lamports} lamports ({item.program})
                </Text>
              )}
            />
          </View>
        )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
