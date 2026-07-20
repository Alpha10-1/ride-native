import React from "react";
import { Text, StyleSheet, ScrollView } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import RowItem from "../../src/components/RowItem";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { logout } from "../../src/lib/auth";

// NOTE: this screen previously duplicated the driver settings screen
// (vehicle details, earnings, payout method, driver promotions, and a
// hard-coded role="driver" in the side menu) — riders were seeing an
// entirely wrong settings page. Rebuilt here with rider-appropriate rows
// and screens.
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
            Profile, payment, saved places and preferences — all in one place.
          </Text>
        </GlassCard>

        <Text style={styles.section}>Account</Text>
        <RowItem icon="person-outline" title="Profile" subtitle="Name, email, photo" onPress={() => router.push("/(rider)/profile")} />
        <RowItem icon="wallet-outline" title="Payment" subtitle="Balance & top-up" onPress={() => router.push("/(rider)/wallet")} />
        <RowItem icon="location-outline" title="Saved Places" subtitle="Home, work, favourites" onPress={() => router.push("/(rider)/saved-places")} />
        <RowItem icon="pricetag-outline" title="Promotions" subtitle="Offers & promo codes" onPress={() => router.push("/(rider)/promotions")} />

        <Text style={styles.section}>Trips</Text>
        <RowItem icon="calendar-outline" title="Scheduled Rides" subtitle="Upcoming bookings" onPress={() => router.push("/(rider)/scheduled-rides")} />
        <RowItem icon="time-outline" title="Trip History" subtitle="Past rides & receipts" onPress={() => router.push("/(rider)/trip-history")} />

        <Text style={styles.section}>Safety</Text>
        <RowItem icon="shield-outline" title="Safety tools" subtitle="Emergency contacts, SOS" onPress={() => router.push("/(rider)/safety")} />

        <Text style={styles.section}>Preferences</Text>
        <RowItem icon="notifications-outline" title="Notifications" subtitle="Push + SMS" onPress={() => router.push("/(rider)/notifications-settings")} />
        <RowItem icon="language-outline" title="Language" subtitle="App language" onPress={() => router.push("/(rider)/language-settings")} />

        <Text style={styles.section}>Legal</Text>
        <RowItem icon="document-text-outline" title="Privacy" subtitle="Data & permissions" onPress={() => router.push("/(rider)/privacy")} />
        <RowItem icon="information-circle-outline" title="About" subtitle="Version, legal" onPress={() => router.push("/(rider)/about")} />

        <Text style={[styles.section, { color: COLORS.red }]}>Session</Text>
        <RowItem
          icon="log-out-outline"
          title="Log out"
          subtitle="Sign out of your account"
          danger
          onPress={() => logout().finally(() => router.replace("/auth/login"))}
        />
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
    </Screen>
  );
}

const styles = StyleSheet.create({
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