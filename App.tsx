import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Button, Text, TextInput } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import ResultsScreen from './src/screens/ResultsScreen';
import { useSweeperStore } from './src/store';

export default function App() {
  const address = useSweeperStore((s) => s.address);
  const loading = useSweeperStore((s) => s.loading);
  const error = useSweeperStore((s) => s.error);
  const hasResults = useSweeperStore((s) => s.results !== null);
  const setAddress = useSweeperStore((s) => s.setAddress);
  const restoreAddress = useSweeperStore((s) => s.restoreAddress);
  const scan = useSweeperStore((s) => s.scan);

  useEffect(() => {
    restoreAddress();
  }, [restoreAddress]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        {hasResults ? (
          <ResultsScreen />
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
            <Button title="Scan" onPress={scan} disabled={loading} />
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
