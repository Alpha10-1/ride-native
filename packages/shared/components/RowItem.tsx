import React from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS } from "../theme/tokens";

export default function RowItem({
  title,
  subtitle,
  icon,
  onPress,
  danger,
  showChevron = true,
}: {
  title: string;
  subtitle?: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress?: () => void;
  danger?: boolean;
  showChevron?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.92 }]}
    >
      <View style={styles.leading}>
        {icon ? <Ionicons name={icon} size={18} color={COLORS.red} /> : null}
      </View>

      <View style={{ flex: 1 }}>
        <Text style={[styles.title, danger && { color: COLORS.red }]}>
          {title}
        </Text>
        {!!subtitle && <Text style={styles.sub}>{subtitle}</Text>}
      </View>

      {showChevron ? (
        <View style={styles.trailing}>
          <Ionicons
            name="chevron-forward"
            size={18}
            color={danger ? COLORS.red : COLORS.text}
          />
        </View>
      ) : (
        <View style={{ width: 34, height: 34 }} />
      )}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    padding: 14,
    borderRadius: RADIUS.xl,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  leading: {
    width: 42,
    height: 42,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  trailing: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  title: {
    color: COLORS.text,
    fontWeight: "900",
    fontSize: 14,
  },
  sub: {
    color: COLORS.textDim,
    fontSize: 12,
    marginTop: 4,
  },
});
