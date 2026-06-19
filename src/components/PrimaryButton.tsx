import React from "react";
import { Pressable, Text, StyleSheet } from "react-native";
import { COLORS, RADIUS } from "../theme/tokens";

export default function PrimaryButton({
  label,
  onPress,
  disabled,
  danger,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  danger?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => [
        styles.btn,
        danger && styles.btnDanger,
        disabled && { opacity: 0.6 },
        pressed && !disabled && { transform: [{ scale: 0.99 }] },
      ]}
    >
      <Text style={[styles.txt, danger && styles.txtDanger]}>{label}</Text>
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
  btnDanger: {
    backgroundColor: "transparent",
    borderWidth: 1,
    borderColor: "rgba(255,46,46,0.5)",
  },
  txt: {
    color: "#000",
    fontWeight: "900",
    fontSize: 16,
  },
  txtDanger: {
    color: COLORS.red,
  },
});