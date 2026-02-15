import React from "react";
import { View, TextInput, StyleSheet } from "react-native";
import { COLORS, RADIUS } from "../theme/tokens";

export default function TextField({
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
}: {
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "phone-pad" | "email-address";
}) {
  return (
    <View style={styles.box}>
      <TextInput
        placeholder={placeholder}
        placeholderTextColor={COLORS.textFaint}
        value={value}
        onChangeText={onChangeText}
        secureTextEntry={secureTextEntry}
        keyboardType={keyboardType}
        style={styles.input}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: {
    backgroundColor: "rgba(0,0,0,0.65)",
    borderRadius: RADIUS.lg,
    paddingVertical: 12,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.05)",
    shadowColor: "#000",
    shadowOpacity: 0.55,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  input: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "600",
  },
});
