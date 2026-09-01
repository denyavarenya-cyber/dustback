import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Button, Text, TextInput, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import DoneScreen from './src/screens/DoneScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import { shortenAddress } from './src/format';
import { useSweeperStore } from './src/store';

export default function App() {
  const view = useSweeperStore((s) => s.view);
  const address = useSweeperStore((s) => s.address);
  const loading = useSweeperStore((s) => s.loading);
  const error = useSweeperStore((s) => s.error);
  const wallet = useSweeperStore((s) => s.wallet);
  const connectError = useSweeperStore((s) => s.connectError);
  const setAddress = useSweeperStore((s) => s.setAddress);
  const restoreAddress = useSweeperStore((s) => s.restoreAddress);
  const scan = useSweeperStore((s) => s.scan);
  const connectWallet = useSweeperStore((s) => s.connectWallet);
  const scanConnectedWallet = useSweeperStore((s) => s.scanConnectedWallet);

  useEffect(() => {
    restoreAddress();
  }, [restoreAddress]);

  return (
    <SafeAreaProvider>
      <SafeAreaView style={{ flex: 1, padding: 16 }}>
        {view === 'results' && <ResultsScreen />}
        {view === 'review' && <ReviewScreen />}
        {view === 'done' && <DoneScreen />}
        {view === 'form' && (
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
            <View style={{ marginTop: 24 }}>
              {wallet ? (
                <>
                  <Text style={{ marginBottom: 8 }}>
                    Connected: {shortenAddress(wallet.address)}
                  </Text>
                  <Button
                    title="Scan connected wallet"
                    onPress={scanConnectedWallet}
                    disabled={loading}
                  />
                </>
              ) : (
                <Button
                  title="Connect wallet"
                  onPress={connectWallet}
                  disabled={loading}
                  color="#888"
                />
              )}
            </View>
            {loading && <ActivityIndicator style={{ marginTop: 16 }} />}
            {error && (
              <Text style={{ color: 'red', marginTop: 16 }}>{error}</Text>
            )}
            {connectError && (
              <Text style={{ color: 'red', marginTop: 16 }}>
                {connectError}
              </Text>
            )}
          </>
        )}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
