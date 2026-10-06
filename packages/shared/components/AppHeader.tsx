import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { COLORS, SPACE } from "../theme/tokens";

export default function AppHeader({
  eyebrow,
  title,
  left,
  onLeftPress,
  right,
}: {
  eyebrow?: string;
  title: string;
  left?: React.ReactNode;
  right?: React.ReactNode;
  onLeftPress?: () => void;
}) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onLeftPress} style={styles.side}>
        {left}
      </Pressable>

      <View style={{ flex: 1 }}>
        {!!eyebrow && <Text style={styles.eyebrow}>{eyebrow}</Text>}
        <Text style={styles.title}>{title}</Text>
      </View>

      <View style={styles.side}>{right}</View>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.sm,
  },
  side: {
    width: 44,
    height: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  eyebrow: {
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
  },
  title: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: "900",
    marginTop: 2,
  },
});
