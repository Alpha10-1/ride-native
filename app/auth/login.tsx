import React, { useMemo, useState } from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import SegmentedTabs from "../../src/components/SegmentedTabs";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";

type Mode = "login" | "register";

export default function LoginScreen() {
  const [mode, setMode] = useState<Mode>("login");

  // login
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");

  // register (keep minimal now; you’ll send the rest later and we’ll expand)
  const [email, setEmail] = useState("");
  const [cellphone, setCellphone] = useState("");
  const [confirm, setConfirm] = useState("");

  const isRegister = mode === "register";

  const canContinue = useMemo(() => {
    if (!username.trim() || !password) return false;
    if (isRegister && password !== confirm) return false;
    return true;
  }, [username, password, confirm, isRegister]);

  return (
    <Screen>
      <View style={styles.wrap}>
        <View style={styles.header}>
          <Text style={styles.logo}>
            <Text style={{ color: COLORS.text }}>R</Text>
            <Text style={{ color: COLORS.red }}>ide</Text>
          </Text>
          <Text style={styles.tagline}>South Africa&apos;s Mobility Platform</Text>

          <Text style={styles.h2}>{isRegister ? "Create Account" : "Welcome Back"}</Text>
          <Text style={styles.sub}>
            {isRegister ? "Register to start using Ride" : "Sign in to continue to your account"}
          </Text>

          <View style={{ marginTop: SPACE.md }}>
            <SegmentedTabs value={mode} onChange={setMode} />
          </View>
        </View>

        <GlassCard style={styles.card}>
          <View style={{ gap: SPACE.sm }}>
            <TextField placeholder="Username" value={username} onChangeText={setUsername} />
            {isRegister && (
              <>
                <TextField placeholder="Email" value={email} onChangeText={setEmail} keyboardType="email-address" />
                <TextField placeholder="Cellphone" value={cellphone} onChangeText={setCellphone} keyboardType="phone-pad" />
              </>
            )}
            <TextField placeholder="Password" value={password} onChangeText={setPassword} secureTextEntry />
            {isRegister && (
              <TextField placeholder="Confirm password" value={confirm} onChangeText={setConfirm} secureTextEntry />
            )}
          </View>

          <View style={{ marginTop: SPACE.md }}>
            <PrimaryButton
              label={isRegister ? "Create account" : "Continue"}
              disabled={!canContinue}
              onPress={() => {
                // for demo: after auth go to role picker
                router.replace("/auth/role");
              }}
            />
          </View>

          {isRegister && password !== confirm && confirm.length > 0 ? (
            <Text style={styles.error}>Passwords do not match.</Text>
          ) : null}
        </GlassCard>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flex: 1,
    justifyContent: "center",
    paddingHorizontal: SPACE.lg,
    gap: SPACE.lg,
  },
  header: {
    alignItems: "center",
    gap: 6,
  },
  logo: {
    fontSize: 46,
    fontWeight: "900",
    letterSpacing: -1,
  },
  tagline: {
    color: "rgba(255,255,255,0.65)",
    marginTop: 4,
  },
  h2: {
    color: COLORS.text,
    fontSize: 32,
    fontWeight: "900",
    marginTop: SPACE.lg,
  },
  sub: {
    color: "rgba(255,255,255,0.65)",
    marginTop: 4,
    textAlign: "center",
  },
  card: {
    gap: SPACE.sm,
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
  },
});
