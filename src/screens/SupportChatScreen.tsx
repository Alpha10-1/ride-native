import React, { useEffect, useState } from "react";
import { Text, StyleSheet, ScrollView, Linking } from "react-native";
import { router } from "expo-router";
import { resetTo } from "../lib/navigation";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import SideMenuDrawer from "../components/SideMenuDrawer";
import GlassCard from "../components/GlassCard";
import RowItem from "../components/RowItem";
import { COLORS, SPACE } from "../theme/tokens";
import { getCurrentProfile } from "../lib/auth";

export default function SupportScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");

  useEffect(() => {
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          resetTo("/auth/login");
          return;
        }
        setRole(profile.role);
      } catch {
        // non-critical for this screen; default to "rider" drawer if it fails
      }
    })();
  }, []);

  return (
    <Screen>
      <RiderHeader subtitle="Help & Support" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard>
          <Text style={styles.kicker}>WE'RE HERE TO HELP</Text>
          <Text style={styles.sub}>
            Reach out if something isn't working as expected, or browse common topics below.
          </Text>
        </GlassCard>

        <Text style={styles.section}>Contact</Text>
        <RowItem
          icon="chatbubble-ellipses-outline"
          title="Chat with Support"
          subtitle="Usually replies within a few hours"
          onPress={() => router.push(role === "driver" ? "/(driver)/support-chat" : "/(rider)/support-chat")}
        />
        <RowItem
          icon="call-outline"
          title="Call Support"
          subtitle="Available 24/7"
          onPress={() => Linking.openURL("tel:+27000000000")}
        />
        <RowItem
          icon="mail-outline"
          title="Email Support"
          subtitle="support@ridenative.app"
          onPress={() => Linking.openURL("mailto:support@ridenative.app")}
        />

        <Text style={styles.section}>Common Topics</Text>
        <RowItem icon="card-outline" title="Payments & billing" onPress={() => {}} />
        <RowItem icon="shield-outline" title="Safety & trust" onPress={() => {}} />
        <RowItem icon="person-outline" title="Account issues" onPress={() => {}} />
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
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