import React from "react";
import { Pressable, Text, View, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle: string;
  selected: boolean;
  onPress: () => void;
};

export default function RoleCard({ icon, title, subtitle, selected, onPress }: Props) {
  return (
    <Pressable
      onPress={onPress}
      style={[styles.card, selected && styles.cardSelected]}
    >
      <View style={[styles.iconWrap, selected && styles.iconWrapSelected]}>
        <Ionicons name={icon} size={26} color={selected ? "#000" : COLORS.text} />
      </View>
      <Text style={[styles.title, selected && styles.titleSelected]}>{title}</Text>
      <Text style={styles.subtitle}>{subtitle}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  card: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: RADIUS.lg,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    paddingVertical: SPACE.md,
    paddingHorizontal: SPACE.sm,
    alignItems: "center",
    gap: 6,
  },
  cardSelected: {
    borderColor: COLORS.red,
    backgroundColor: "rgba(255,46,46,0.08)",
  },
  iconWrap: {
    width: 48,
    height: 48,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 4,
  },
  iconWrapSelected: {
    backgroundColor: COLORS.red,
  },
  title: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 15,
  },
  titleSelected: {
    color: COLORS.text,
  },
  subtitle: {
    color: COLORS.textFaint,
    fontSize: 11,
    textAlign: "center",
  },
});