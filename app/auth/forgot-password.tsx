import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { requestPasswordReset } from "../../src/lib/auth";

export default function ForgotPasswordScreen() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [sent, setSent] = useState(false);

  const handleSubmit = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    try {
      await requestPasswordReset(email);
    } catch {
      // Deliberately swallowed — never confirm/deny whether an account
      // exists for this email.
    } finally {
      setSubmitting(false);
      setSent(true);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.h2}>Forgot Password</Text>
          <Text style={styles.sub}>
            Enter the email you verified with your account and we'll send you a reset link.
          </Text>
        </View>

        <GlassCard style={{ gap: SPACE.sm }}>
          {sent ? (
            <View style={{ gap: 10, alignItems: "center", paddingVertical: 8 }}>
              <Ionicons name="mail-outline" size={36} color={COLORS.red} />
              <Text style={styles.sentTitle}>Check your email</Text>
              <Text style={styles.sentSub}>
                If that email is on file, we've sent a link to reset your password. It may take a
                few minutes to arrive.
              </Text>
            </View>
          ) : (
            <>
              <TextField
                label="Email"
                placeholder="you@example.com"
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
              />
              <View style={{ marginTop: SPACE.sm }}>
                <PrimaryButton
                  label={submitting ? "Sending..." : "Send Reset Link"}
                  onPress={handleSubmit}
                  disabled={!email.trim() || submitting}
                />
              </View>
            </>
          )}

          <Text style={styles.backLink} onPress={() => router.replace("/auth/login")}>
            Back to Login
          </Text>
        </GlassCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  scrollContent: { paddingHorizontal: SPACE.lg, paddingVertical: SPACE.xl, gap: SPACE.lg },
  header: { alignItems: "center", gap: 6 },
  h2: { color: COLORS.text, fontSize: 26, fontWeight: "900" },
  sub: { color: "rgba(255,255,255,0.65)", textAlign: "center" },
  sentTitle: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  sentSub: { color: COLORS.textDim, textAlign: "center", fontSize: 13, lineHeight: 19 },
  backLink: {
    color: COLORS.red, fontWeight: "800", textAlign: "center",
    marginTop: SPACE.sm, fontSize: 13,
  },
});
