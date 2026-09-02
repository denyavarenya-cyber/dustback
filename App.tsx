import { StatusBar } from 'expo-status-bar';
import { useEffect } from 'react';
import { ActivityIndicator, Text, TextInput, View } from 'react-native';
import {
  SafeAreaProvider,
  SafeAreaView,
} from 'react-native-safe-area-context';
import { shortenAddress } from './src/format';
import DoneScreen from './src/screens/DoneScreen';
import ResultsScreen from './src/screens/ResultsScreen';
import ReviewScreen from './src/screens/ReviewScreen';
import { useSweeperStore } from './src/store';
import { radius, screenPad, useTheme } from './src/theme';
import { Btn } from './src/ui';

function ScanScreen() {
  const t = useTheme();
  const address = useSweeperStore((s) => s.address);
  const loading = useSweeperStore((s) => s.loading);
  const error = useSweeperStore((s) => s.error);
  const wallet = useSweeperStore((s) => s.wallet);
  const connectError = useSweeperStore((s) => s.connectError);
  const setAddress = useSweeperStore((s) => s.setAddress);
  const scan = useSweeperStore((s) => s.scan);
  const connectWallet = useSweeperStore((s) => s.connectWallet);
  const scanConnectedWallet = useSweeperStore((s) => s.scanConnectedWallet);

  return (
    <View style={{ flex: 1 }}>
      <Text style={{ color: t.accent, fontSize: 20, fontWeight: '700' }}>
        DustBack
      </Text>
      <Text
        style={{
          color: t.text,
          fontSize: 30,
          fontWeight: '700',
          marginTop: 28,
        }}
      >
        See what your wallet owes you
      </Text>
      <Text style={{ color: t.textSecondary, fontSize: 15, marginTop: 10 }}>
        Empty token accounts and dust balances hold small amounts of SOL.
        DustBack finds them and returns what is yours.
      </Text>

      <TextInput
        value={address}
        onChangeText={setAddress}
        placeholder="Wallet address"
        placeholderTextColor={t.textSecondary}
        autoCapitalize="none"
        autoCorrect={false}
        style={{
          backgroundColor: t.surface,
          color: t.text,
          borderWidth: 1,
          borderColor: t.border,
          borderRadius: radius,
          padding: 14,
          marginTop: 24,
        }}
      />
      <Btn
        title="Scan"
        onPress={scan}
        disabled={loading}
        style={{ marginTop: 12 }}
      />
      {wallet ? (
        <View style={{ marginTop: 12 }}>
          <Text style={{ color: t.textSecondary, marginBottom: 8 }}>
            Connected: {shortenAddress(wallet.address)}
          </Text>
          <Btn
            title="Scan connected wallet"
            variant="secondary"
            onPress={scanConnectedWallet}
            disabled={loading}
          />
        </View>
      ) : (
        <Btn
          title="Connect wallet"
          variant="secondary"
          onPress={connectWallet}
          disabled={loading}
          style={{ marginTop: 12 }}
        />
      )}

      {loading && <ActivityIndicator color={t.accent} style={{ marginTop: 20 }} />}
      {error && (
        <Text style={{ color: t.danger, marginTop: 16 }}>{error}</Text>
      )}
      {connectError && (
        <Text style={{ color: t.danger, marginTop: 16 }}>{connectError}</Text>
      )}

      <View style={{ flex: 1 }} />
      <Text
        style={{
          color: t.textSecondary,
          fontSize: 13,
          marginBottom: 8,
          lineHeight: 18,
        }}
      >
        Scanning is read-only. No connection, no signature, no permissions —
        just a public address.
      </Text>
    </View>
  );
}

export default function App() {
  const t = useTheme();
  const view = useSweeperStore((s) => s.view);
  const restoreAddress = useSweeperStore((s) => s.restoreAddress);

  useEffect(() => {
    restoreAddress();
  }, [restoreAddress]);

  return (
    <SafeAreaProvider>
      <SafeAreaView
        style={{ flex: 1, backgroundColor: t.bg, padding: screenPad }}
      >
        {view === 'form' && <ScanScreen />}
        {view === 'results' && <ResultsScreen />}
        {view === 'review' && <ReviewScreen />}
        {view === 'done' && <DoneScreen />}
        <StatusBar style="auto" />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}
