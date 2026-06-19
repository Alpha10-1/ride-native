import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getCurrentProfile, updatePreferences, Language } from "../../src/lib/auth";

const LANGUAGES: { code: Language; label: string; native: string }[] = [
  { code: "en", label: "English", native: "English" },
  { code: "af", label: "Afrikaans", native: "Afrikaans" },
  { code: "zu", label: "Zulu", native: "isiZulu" },
  { code: "xh", label: "Xhosa", native: "isiXhosa" },
];

export default function LanguageScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Language>("en");

  useEffect(() => {
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          router.replace("/auth/login");
          return;
        }
        setSelected((profile.language as Language) ?? "en");
      } catch (e: any) {
        setError(e?.message ?? "Failed to load preferences.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSelect = async (code: Language) => {
    if (code === selected || saving) return;
    const prev = selected;
    setSelected(code);
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({ language: code });
    } catch (e: any) {
      setSelected(prev);
      setError(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Language" menuOpen={false} onMenu={() => router.back()} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Language" menuOpen={false} onMenu={() => router.back()} />
      <View style={{ paddingHorizontal: SPACE.md, gap: SPACE.sm }}>
        <GlassCard>
          <Text style={styles.kicker}>APP LANGUAGE</Text>
          <Text style={styles.sub}>
            Choose the language you'd like to use in the app.
          </Text>
        </GlassCard>

        {LANGUAGES.map((lang) => {
          const isSelected = selected === lang.code;
          return (
            <Pressable
              key={lang.code}
              onPress={() => handleSelect(lang.code)}
              style={({ pressed }) => [
                styles.row,
                isSelected && styles.rowSelected,
                pressed && { opacity: 0.85 },
              ]}
              disabled={saving}
            >
              <View style={{ flex: 1 }}>
                <Text style={[styles.langLabel, isSelected && styles.langLabelSelected]}>
                  {lang.label}
                </Text>
                <Text style={styles.langNative}>{lang.native}</Text>
              </View>
              {isSelected ? (
                <Ionicons name="checkmark-circle" size={22} color={COLORS.red} />
              ) : (
                <Ionicons name="ellipse-outline" size={22} color="rgba(255,255,255,0.2)" />
              )}
            </Pressable>
          );
        })}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  sub: { color: COLORS.textDim, marginTop: 6, fontSize: 13, lineHeight: 18 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    padding: SPACE.md,
    borderRadius: RADIUS.xl,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  rowSelected: {
    borderColor: COLORS.red,
    backgroundColor: "rgba(255,46,46,0.08)",
  },
  langLabel: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 15,
  },
  langLabelSelected: {
    color: COLORS.text,
  },
  langNative: {
    color: COLORS.textDim,
    fontSize: 12,
    marginTop: 2,
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});