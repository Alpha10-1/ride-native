import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import { COLORS, SPACE } from "../theme/tokens";
import { getAppContent } from "../lib/appContent";

export default function LegalDocScreen() {
  const { docKey } = useLocalSearchParams<{ docKey: string }>();
  const [loading, setLoading] = useState(true);
  const [title, setTitle] = useState("Document");
  const [body, setBody] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!docKey) return;
    let cancelled = false;
    getAppContent(docKey)
      .then((content) => {
        if (cancelled) return;
        if (content) {
          setTitle(content.title);
          setBody(content.body);
        } else {
          setError("This document isn't available right now.");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(e?.message ?? "Failed to load document.");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => { cancelled = true; };
  }, [docKey]);

  return (
    <Screen>
      <RiderHeader subtitle={title} menuOpen={false} onMenu={() => router.back()} />
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      ) : error ? (
        <View style={styles.centerFill}>
          <Text style={styles.error}>{error}</Text>
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={{ padding: SPACE.md, paddingBottom: 60 }}
          showsVerticalScrollIndicator={false}
        >
          <Text style={styles.body}>{body}</Text>
        </ScrollView>
      )}
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingHorizontal: SPACE.lg },
  body: { color: COLORS.textDim, fontSize: 13, lineHeight: 21 },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", textAlign: "center" },
});