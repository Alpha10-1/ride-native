import React from "react";
import { View, Text, StyleSheet, Linking, ScrollView } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import RowItem from "../../src/components/RowItem";
import { COLORS, SPACE } from "../../src/theme/tokens";

const APP_VERSION = "1.0.0";

export default function AboutScreen() {
  return (
    <Screen>
      <RiderHeader subtitle="About" menuOpen={false} onMenu={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard style={styles.brandCard}>
          <Text style={styles.logo}>
            <Text style={{ color: COLORS.text }}>R</Text>
            <Text style={{ color: COLORS.red }}>ide</Text>
          </Text>
          <Text style={styles.tagline}>South Africa's Mobility Platform</Text>
          <Text style={styles.version}>Version {APP_VERSION}</Text>
        </GlassCard>

        <Text style={styles.section}>Legal</Text>
        <RowItem
          icon="document-text-outline"
          title="Terms & Conditions"
          subtitle="Usage terms"
          onPress={() => Linking.openURL("https://ridenative.app/terms")}
        />
        <RowItem
          icon="shield-checkmark-outline"
          title="Privacy Policy"
          subtitle="How we handle your data"
          onPress={() => Linking.openURL("https://ridenative.app/privacy")}
        />

        <Text style={styles.section}>Contact</Text>
        <RowItem
          icon="mail-outline"
          title="Contact Us"
          subtitle="hello@ridenative.app"
          onPress={() => Linking.openURL("mailto:hello@ridenative.app")}
        />
        <RowItem
          icon="globe-outline"
          title="Website"
          subtitle="ridenative.app"
          onPress={() => Linking.openURL("https://ridenative.app")}
        />

        <Text style={styles.copyright}>
          © {new Date().getFullYear()} Ride. All rights reserved.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  brandCard: {
    alignItems: "center",
    paddingVertical: SPACE.lg,
    gap: 6,
  },
  logo: {
    fontSize: 40,
    fontWeight: "900",
    letterSpacing: -1,
  },
  tagline: {
    color: COLORS.textDim,
    fontSize: 13,
  },
  version: {
    color: COLORS.textFaint,
    fontSize: 12,
    marginTop: 4,
  },
  section: {
    marginTop: SPACE.md,
    marginBottom: 6,
    paddingLeft: 4,
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  copyright: {
    color: COLORS.textFaint,
    fontSize: 11,
    textAlign: "center",
    marginTop: SPACE.lg,
  },
});