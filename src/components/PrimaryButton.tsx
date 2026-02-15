import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { COLORS, RADIUS } from "../theme/tokens";

export default function PrimaryButton({
  label,
  onPress,
  disabled,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        disabled && { opacity: 0.6 },
        pressed && !disabled && { transform: [{ scale: 0.99 }] },
      ]}
    >
      <Text style={styles.txt}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  btn: {
    height: 52,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  txt: {
    color: "#000",
    fontWeight: "900",
    fontSize: 16,
  },
});
