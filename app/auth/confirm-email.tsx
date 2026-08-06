import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { exchangeRecoverySession } from "../../src/lib/auth";

// Opened via the ridenative://auth/confirm-email deep link sent by
// linkRecoveryEmail() (src/lib/auth.ts). Tapping the emailed "Confirm new
// email address" link hands the app a session token in the URL — once
// exchanged, Supabase has already applied the email change server-side,
// so this screen just needs to report success (or a stale/expired link).
export default function ConfirmEmailScreen() {
  const [status, setStatus] = useState<"pending" | "done" | "error">("pending");
  const [linkError, setLinkError] = useState<string | null>(null);

  useEffect(() => {
    let handled = false;
    const tryExchange = async (url: string | null) => {
      if (!url || handled) return;
      handled = true;
      try {
        await exchangeRecoverySession(url);
        setStatus("done");
      } catch (e: any) {
        setLinkError(e?.message ?? "This confirmation link is invalid or has expired. Please request a new one.");
        setStatus("error");
      }
    };

    Linking.getInitialURL().then(tryExchange);
    const sub = Linking.addEventListener("url", ({ url }) => tryExchange(url));

    // Same rationale as reset-password.tsx: if this screen was somehow
    // reached without a link firing either listener, stop spinning.
    const timeout = setTimeout(() => {
      if (!handled) {
        setLinkError("This confirmation link is missing or already used. Please request a new one.");
        setStatus("error");
      }
    }, 4000);

    return () => {
      sub.remove();
      clearTimeout(timeout);
    };
  }, []);

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.h2}>Confirm Email</Text>
        </View>

        <GlassCard style={{ gap: SPACE.sm }}>
          {status === "pending" ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={COLORS.red} />
            </View>
          ) : status === "error" ? (
            <View style={{ gap: 10, alignItems: "center", paddingVertical: 8 }}>
              <Text style={styles.error}>{linkError}</Text>
              <PrimaryButton label="Back to Login" onPress={() => router.replace("/auth/login")} />
            </View>
          ) : (
            <View style={{ gap: 10, alignItems: "center", paddingVertical: 8 }}>
              <Text style={styles.sentTitle}>Email confirmed</Text>
              <Text style={styles.sentSub}>
                Your recovery email is now verified. You can use it to recover your account if you ever forget your password.
              </Text>
              <View style={{ width: "100%", marginTop: SPACE.sm }}>
                <PrimaryButton label="Continue" onPress={() => router.replace("/")} />
              </View>
            </View>
          )}
        </GlassCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.xl, gap: SPACE.lg },
  header: { alignItems: "center", gap: 6 },
  h2: { color: COLORS.text, fontSize: 26, fontWeight: "900" },
  sentTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  sentSub: { color: COLORS.textDim, textAlign: "center", fontSize: 13, lineHeight: 19 },
  error: {
    color: "rgba(255,90,90,0.95)", fontWeight: "700", textAlign: "center", fontSize: 13,
  },
});