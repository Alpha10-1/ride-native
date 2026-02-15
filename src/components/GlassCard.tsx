import React from "react";
import { View, StyleSheet, ViewStyle } from "react-native";
import { COLORS, RADIUS } from "../theme/tokens";

export default function GlassCard({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
}) {
  return <View style={[styles.card, style]}>{children}</View>;
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: COLORS.glass,
    borderRadius: RADIUS.xl,
    borderWidth: 1,
    borderColor: COLORS.borderRed,
    padding: 16,
    shadowColor: "#000",
    shadowOpacity: 0.6,
    shadowRadius: 30,
    shadowOffset: { width: 0, height: 14 },
    elevation: 10,
  },
});
