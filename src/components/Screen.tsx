import React from "react";
import { View, StyleSheet, StatusBar } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../theme/tokens";

export default function Screen({ children }: { children: React.ReactNode }) {
  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View pointerEvents="none" style={styles.glowTop} />
      <View pointerEvents="none" style={styles.glowBottom} />
      <View style={styles.body}>{children}</View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: COLORS.bg,
  },
  body: {
    flex: 1,
  },
  glowTop: {
    position: "absolute",
    top: -200,
    left: -120,
    right: -120,
    height: 360,
    borderRadius: 999,
    shadowColor: COLORS.red,
    shadowOpacity: 0.25,
    shadowRadius: 140,
    shadowOffset: { width: 0, height: 60 },
  },
  glowBottom: {
    position: "absolute",
    bottom: -260,
    left: -140,
    right: -140,
    height: 420,
    borderRadius: 999,
    shadowColor: COLORS.red,
    shadowOpacity: 0.12,
    shadowRadius: 180,
    shadowOffset: { width: 0, height: -80 },
  },
});
