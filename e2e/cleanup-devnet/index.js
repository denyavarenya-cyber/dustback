// Harness only: one feature screen on its own, with the app's theme and fonts.
// exp://127.0.0.1:8090                       -> wallet cleanup
// exp://127.0.0.1:8090/--/swap?mint=<mint>   -> swap confirm screen (mock mode)
import React, { useEffect, useState } from 'react';
import { Linking } from 'react-native';
import { registerRootComponent } from 'expo';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { ThemeProvider } from '../src/shared/context/ThemeContext';
import { appFonts } from '../src/shared/design/fonts';
import { CleanupScreen, SwapPreviewScreen } from '../src/features/cleanup';

function useTarget() {
  const [url, setUrl] = useState(undefined);
  useEffect(() => {
    Linking.getInitialURL().then((u) => setUrl(u ?? ''));
    const sub = Linking.addEventListener('url', (e) => setUrl(e.url));
    return () => sub.remove();
  }, []);
  if (url === undefined) return null;
  const m = /\/--\/swap\?mint=([1-9A-HJ-NP-Za-km-z]{32,44})/.exec(url);
  return m ? { screen: 'swap', mint: m[1] } : { screen: 'cleanup' };
}

function Harness() {
  const [loaded, error] = useFonts(appFonts);
  const target = useTarget();
  if ((!loaded && !error) || target === null) return null;
  const nav = { goBack() {} };
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="light" />
        {target.screen === 'swap' ? (
          <SwapPreviewScreen key={target.mint} navigation={nav} route={{ params: { mint: target.mint } }} />
        ) : (
          <CleanupScreen navigation={nav} />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

registerRootComponent(Harness);
