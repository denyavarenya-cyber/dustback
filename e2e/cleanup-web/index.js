// Harness only, web: the passport's "Found in your wallets" block as the
// passport draws it (agent 1's strings), with cleanup's real button inside, and
// cleanup's real screen behind it. Wallets come from the Wallet Standard.
import React, { useState } from "react";
import { ScrollView, StyleSheet } from "react-native";
import { registerRootComponent } from "expo";
import { StatusBar } from "expo-status-bar";
import { useFonts } from "expo-font";
import { SafeAreaProvider } from "react-native-safe-area-context";
import { ThemeProvider } from "../src/shared/context/ThemeContext";
import { appFonts } from "../src/shared/design/fonts";
import { CleanupScreen, FoundCleanupLink } from "../src/features/cleanup";
import { colors, spacing, Text, V5Card, V5Screen } from "../src/features/cleanup/components/design";

function PassportBlock({ onOpen }) {
  return (
    <V5Screen>
      <ScrollView contentContainerStyle={styles.page}>
        <Text variant="title">Passport</Text>
        <V5Card style={styles.card}>
          <Text variant="caption" color={colors.textMuted}>
            Found in your wallets
          </Text>
          <Text variant="title" style={styles.rent}>
            0.0102312 SOL of rent to reclaim
          </Text>
          <Text variant="body" color={colors.textMuted}>
            From 5 empty token accounts
          </Text>
          <FoundCleanupLink navigation={{ navigate: onOpen }} />
        </V5Card>
      </ScrollView>
    </V5Screen>
  );
}

function Harness() {
  const [loaded, error] = useFonts(appFonts);
  const [screen, setScreen] = useState("passport");
  if (!loaded && !error) return null;
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <StatusBar style="light" />
        {screen === "passport" ? (
          <PassportBlock onOpen={() => setScreen("cleanup")} />
        ) : (
          <CleanupScreen navigation={{ goBack: () => setScreen("passport") }} />
        )}
      </ThemeProvider>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.md, maxWidth: 560, width: "100%", alignSelf: "center" },
  card: { marginTop: spacing.md },
  rent: { marginTop: spacing.xs },
});

registerRootComponent(Harness);
