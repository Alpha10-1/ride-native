import React from "react";
import { View, Text, TextInput, StyleSheet } from "react-native";
import { COLORS, RADIUS } from "../theme/tokens";

export default function TextField({
  label,
  placeholder,
  value,
  onChangeText,
  secureTextEntry,
  keyboardType,
  autoCapitalize,
}: {
  label?: string;
  placeholder: string;
  value: string;
  onChangeText: (t: string) => void;
  secureTextEntry?: boolean;
  keyboardType?: "default" | "phone-pad" | "email-address" | "numeric";
  autoCapitalize?: "none" | "sentences" | "words" | "characters";
}) {
  return (
    <View style={{ gap: 6 }}>
      {label ? <Text style={styles.label}>{label}</Text> : null}
      <View style={styles.box}>
        <TextInput
          placeholder={placeholder}
          placeholderTextColor={COLORS.textFaint}
          value={value}
          onChangeText={onChangeText}
          secureTextEntry={secureTextEntry}
          keyboardType={keyboardType}
          autoCapitalize={autoCapitalize ?? "none"}
          style={styles.input}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  label: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 13,
    textAlign: "center",
  },
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