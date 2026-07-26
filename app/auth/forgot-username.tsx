import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { requestUsernameRecoveryOtp, verifyUsernameRecoveryOtp } from "../../src/lib/auth";

type Step = "email" | "code" | "revealed";

export default function ForgotUsernameScreen() {
  const [step, setStep] = useState<Step>("email");
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [username, setUsername] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSendCode = async () => {
    if (!email.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      await requestUsernameRecoveryOtp(email);
    } catch {
      // Deliberately swallowed — never confirm/deny whether an account
      // exists for this email.
    } finally {
      setSubmitting(false);
      setStep("code");
    }
  };

  const handleVerify = async () => {
    if (!code.trim() || submitting) return;
    setSubmitting(true);
    setError(null);
    try {
      const foundUsername = await verifyUsernameRecoveryOtp(email, code);
      setUsername(foundUsername);
      setStep("revealed");
    } catch (e: any) {
      setError(e?.message ?? "That code didn't work. Please check it and try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.scrollContent} keyboardShouldPersistTaps="handled">
        <View style={styles.header}>
          <Text style={styles.h2}>Forgot Username</Text>
          <Text style={styles.sub}>
            {step === "email" && "Enter the email you verified with your account."}
            {step === "code" && "Enter the code we sent to your email."}
            {step === "revealed" && "Here's your username."}
          </Text>
        </View>

        <GlassCard style={{ gap: SPACE.sm }}>
          {step === "email" && (
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
                  label={submitting ? "Sending..." : "Send Code"}
                  onPress={handleSendCode}
                  disabled={!email.trim() || submitting}
                />
              </View>
            </>
          )}

          {step === "code" && (
            <>
              <Text style={styles.emailEcho}>{email}</Text>
              <TextField
                label="Verification Code"
                placeholder="6-digit code"
                value={code}
                onChangeText={setCode}
                keyboardType="number-pad"
              />
              {error ? <Text style={styles.error}>{error}</Text> : null}
              <View style={{ marginTop: SPACE.sm }}>
                <PrimaryButton
                  label={submitting ? "Verifying..." : "Verify Code"}
                  onPress={handleVerify}
                  disabled={!code.trim() || submitting}
                />
              </View>
              <Text style={styles.resendLink} onPress={handleSendCode}>
                Didn't get a code? Resend
              </Text>
            </>
          )}

          {step === "revealed" && (
            <View style={{ gap: 10, alignItems: "center", paddingVertical: 8 }}>
              <Ionicons name="person-circle-outline" size={40} color={COLORS.red} />
              <Text style={styles.usernameValue}>{username}</Text>
              <View style={{ width: "100%", marginTop: SPACE.sm }}>
                <PrimaryButton label="Go to Login" onPress={() => router.replace("/auth/login")} />
              </View>
            </View>
          )}

          {step !== "revealed" && (
            <Text style={styles.backLink} onPress={() => router.replace("/auth/login")}>
              Back to Login
            </Text>
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
  sub: { color: "rgba(255,255,255,0.65)", textAlign: "center" },
  emailEcho: { color: COLORS.textDim, textAlign: "center", fontSize: 13, marginBottom: 4 },
  usernameValue: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  error: {
    color: "rgba(255,90,90,0.95)", fontWeight: "700", textAlign: "center", fontSize: 13,
  },
  backLink: {
    color: COLORS.red, fontWeight: "800", textAlign: "center",
    marginTop: SPACE.sm, fontSize: 13,
  },
  resendLink: {
    color: COLORS.textDim, fontWeight: "700", textAlign: "center",
    marginTop: SPACE.xs, fontSize: 12,
  },
});
