// src/components/SettingRow.tsx
import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { COLORS, RADIUS } from "../theme/tokens";

export default function SettingRow({
  title,
  desc,
  icon,
  onPress,
  right,
}: {
  title: string;
  desc?: string;
  icon?: React.ReactNode;
  onPress?: () => void;
  right?: React.ReactNode;
}) {
  return (
    <Pressable onPress={onPress} style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}>
      <View style={styles.leading}>{icon}</View>

      <View style={{ flex: 1, minWidth: 0 }}>
        <Text style={styles.title} numberOfLines={1}>{title}</Text>
        {!!desc && (
          <Text style={styles.desc} numberOfLines={1}>{desc}</Text>
        )}
      </View>

      <View style={styles.trailing}>{right}</View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 14,
    paddingHorizontal: 14,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.glassSoft,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  leading: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.chip,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  trailing: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: COLORS.chip,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  title: { color: COLORS.text, fontSize: 14, fontWeight: "800" },
  desc: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
});
