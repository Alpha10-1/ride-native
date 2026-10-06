import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { RADIUS, SPACE } from "../theme/tokens";
import { TestModeStatus, TEST_MODE_CAPABILITY_LABELS } from "../lib/testMode";

// Shown on the driver home screen whenever this account has test_mode
// active (set by an admin via admin_set_driver_test_mode) — makes it
// obvious to the driver why certain actions might be unavailable,
// instead of them just silently failing or wondering why a button is
// missing.
export default function TestModeBanner({ status }: { status: TestModeStatus }) {
  if (!status.testMode) return null;

  const allowed = Object.entries(status.permissions)
    .filter(([, v]) => v)
    .map(([k]) => TEST_MODE_CAPABILITY_LABELS[k as keyof typeof TEST_MODE_CAPABILITY_LABELS])
    .filter(Boolean);

  return (
    <View style={styles.banner}>
      <Ionicons name="flask-outline" size={16} color="#000" />
      <View style={{ flex: 1 }}>
        <Text style={styles.title}>Test Mode Active</Text>
        <Text style={styles.subtitle}>
          {allowed.length > 0
            ? `Enabled for you: ${allowed.join(", ")}`
            : "No features have been enabled for your account yet — contact your admin."}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: SPACE.sm,
    backgroundColor: "#ffd23f",
    borderRadius: RADIUS.md,
    padding: SPACE.sm,
    marginHorizontal: SPACE.md,
    marginTop: SPACE.sm,
  },
  title: { color: "#000", fontWeight: "900", fontSize: 13 },
  subtitle: { color: "#000", fontSize: 11.5, marginTop: 2, lineHeight: 15, opacity: 0.85 },
});
