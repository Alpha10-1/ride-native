import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import RowItem from "../../src/components/RowItem";
import { ScrollView } from "react-native";
import { COLORS, SPACE } from "../../src/theme/tokens";

export default function RiderSettings() {
  const [menuOpen, setMenuOpen] = React.useState(false);
  return (
    <Screen>
      <RiderHeader
        subtitle="Settings"
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
      />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <GlassCard>
          <Text style={styles.kicker}>MANAGE YOUR ACCOUNT</Text>
          <Text style={styles.sub}>
            Profile, safety, payments and preferences — all in one place.
          </Text>
        </GlassCard>

        <Text style={styles.section}>Account</Text>
        <RowItem icon="person-outline" title="Profile" subtitle="Name, email, photo" onPress={() => {}} />
        <RowItem icon="bookmark-outline" title="Saved places" subtitle="Home, Work, favourites" onPress={() => {}} />

        <Text style={styles.section}>Payments</Text>
        <RowItem icon="card-outline" title="Payments" subtitle="Cash / card options" onPress={() => {}} />
        <RowItem icon="pricetag-outline" title="Promotions" subtitle="Vouchers & deals" onPress={() => {}} />

        <Text style={styles.section}>Safety</Text>
        <RowItem icon="shield-outline" title="Safety tools" subtitle="Emergency, share trip" onPress={() => {}} />
        <RowItem icon="key-outline" title="Trip PIN" subtitle="Extra verification" onPress={() => {}} />

        <Text style={styles.section}>Preferences</Text>
        <RowItem icon="notifications-outline" title="Notifications" subtitle="Push + SMS" onPress={() => {}} />
        <RowItem icon="language-outline" title="Language" subtitle="App language" onPress={() => {}} /> 
        <Text style={styles.section}>Legal</Text>
        <RowItem icon="document-text-outline" title="Privacy" subtitle="Data & permissions" onPress={() => {}} />
        <RowItem icon="information-circle-outline" title="About" subtitle="Version, legal" onPress={() => {}} />

        <Text style={[styles.section, { color: COLORS.red }]}>Session</Text>
        <RowItem
            icon="log-out-outline"
            title="Log out"
            subtitle="Sign out of your account"
            danger
            onPress={() => router.replace("/auth/login")}
        />
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACE.md, gap: SPACE.sm, paddingBottom: 120 },
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  sub: { color: COLORS.textDim, marginTop: 6, fontSize: 13, lineHeight: 18 },
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
});
