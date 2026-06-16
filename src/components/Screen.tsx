import React from "react";
import { View, StyleSheet, StatusBar, Platform } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { COLORS } from "../theme/tokens";

export default function Screen({ children }: { children: React.ReactNode }) {
  const Container: any = Platform.OS === "web" ? View : SafeAreaView;

  return (
    <Container style={styles.safe}>
      <StatusBar barStyle="light-content" />
      <View style={styles.glowTop} />
      <View style={styles.glowBottom} />
      <View style={styles.body}>{children}</View>
    </Container>
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

    // ✅ react-native-web prefers boxShadow
    ...(Platform.OS === "web"
      ? { boxShadow: `0px 60px 140px rgba(255,0,0,0.25)` }
      : {
          shadowColor: COLORS.red,
          shadowOpacity: 0.25,
          shadowRadius: 140,
          shadowOffset: { width: 0, height: 60 },
          elevation: 0,
        }),

    // ✅ pointerEvents prop is deprecated on web, so set via style
    pointerEvents: "none",
  },
  glowBottom: {
    position: "absolute",
    bottom: -260,
    left: -140,
    right: -140,
    height: 420,
    borderRadius: 999,

    ...(Platform.OS === "web"
      ? { boxShadow: `0px -80px 180px rgba(255,0,0,0.12)` }
      : {
          shadowColor: COLORS.red,
          shadowOpacity: 0.12,
          shadowRadius: 180,
          shadowOffset: { width: 0, height: -80 },
          elevation: 0,
        }),

    pointerEvents: "none",
  },
});
