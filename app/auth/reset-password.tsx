import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import * as Linking from "expo-linking";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { exchangeRecoverySession, completePasswordReset } from "../../src/lib/auth";

export default function ResetPasswordScreen() {
  const [ready, setReady] = useState(false);
  const [linkError, setLinkError] = useState<string | null>(null);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  // The recovery link opens the app at this exact route with the session
  // tokens attached (either as ?code= or #access_token=) — grab whichever
  // URL actually opened the app and hand it to Supabase. getInitialURL()
  // only covers a cold start (app wasn't running); if the app was already
  // open in the background, tapping the email link fires a 'url' event
  // instead and getInitialURL() comes back null — without this listener,
  // "forgot password" silently fails to advance for anyone who didn't
  // fully close the app first.
  useEffect(() => {
    let handled = false;
    const tryExchange = async (url: string | null) => {
      if (!url || handled) return;
      handled = true;
      try {
        await exchangeRecoverySession(url);
        setReady(true);
      } catch (e: any) {
        setLinkError(e?.message ?? "This reset link is invalid or has expired. Please request a new one.");
      }
    };

    Linking.getInitialURL().then(tryExchange);
    const sub = Linking.addEventListener("url", ({ url }) => tryExchange(url));

    // If neither fires within a few seconds (e.g. this screen was reached
    // some other way, with no link at all), stop showing a spinner.
    const timeout = setTimeout(() => {
      if (!handled) {
        setLinkError("This reset link is missing or already used. Please request a new one.");
      }
    }, 4000);

    return () => {
      sub.remove();
      clearTimeout(timeout);
    };
  }, []);

  const canSubmit = password.length >= 8 && password === confirm;

  const handleSubmit = async () => {
    if (!canSubmit || submitting) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      await completePasswordReset(password);
      setDone(true);
    } catch (e: any) {
      setSubmitError(e?.message ?? "Couldn't update your password. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.h2}>Reset Password</Text>
        </View>

        <GlassCard style={{ gap: SPACE.sm }}>
          {linkError ? (
            <View style={{ gap: 10, alignItems: "center", paddingVertical: 8 }}>
              <Text style={styles.error}>{linkError}</Text>
              <PrimaryButton label="Back to Login" onPress={() => router.replace("/auth/login")} />
            </View>
          ) : !ready ? (
            <View style={{ paddingVertical: 24, alignItems: "center" }}>
              <ActivityIndicator color={COLORS.red} />
            </View>
          ) : done ? (
            <View style={{ gap: 10, alignItems: "center", paddingVertical: 8 }}>
              <Text style={styles.sentTitle}>Password updated</Text>
              <Text style={styles.sentSub}>You can now sign in with your new password.</Text>
              <View style={{ width: "100%", marginTop: SPACE.sm }}>
                <PrimaryButton label="Go to Login" onPress={() => router.replace("/auth/login")} />
              </View>
            </View>
          ) : (
            <>
              <Text style={styles.sub}>Choose a new password for your account.</Text>
              <TextField
                label="New Password"
                placeholder="At least 8 characters"
                value={password}
                onChangeText={setPassword}
                secureTextEntry
              />
              <TextField
                label="Confirm Password"
                placeholder="Re-enter your new password"
                value={confirm}
                onChangeText={setConfirm}
                secureTextEntry
              />
              {confirm.length > 0 && password !== confirm ? (
                <Text style={styles.error}>Passwords do not match.</Text>
              ) : null}
              {submitError ? <Text style={styles.error}>{submitError}</Text> : null}
              <View style={{ marginTop: SPACE.sm }}>
                <PrimaryButton
                  label={submitting ? "Updating..." : "Update Password"}
                  onPress={handleSubmit}
                  disabled={!canSubmit || submitting}
                />
              </View>
            </>
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
  sub: { color: "rgba(255,255,255,0.65)", textAlign: "center", marginBottom: 4 },
  sentTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  sentSub: { color: COLORS.textDim, textAlign: "center", fontSize: 13, lineHeight: 19 },
  error: {
    color: "rgba(255,90,90,0.95)", fontWeight: "700", textAlign: "center", fontSize: 13,
  },
});
