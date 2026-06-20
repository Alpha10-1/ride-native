import React, { useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";

export default function DriverHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useState(false);

  return (
    <Screen>
      <RiderHeader
        subtitle={online ? "You're Online" : "You're Offline"}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
      />

      <View style={styles.container}>
        {/* Online/offline toggle card */}
        <GlassCard style={styles.statusCard}>
          <View style={[styles.statusDot, online && styles.statusDotOnline]} />
          <Text style={styles.statusTitle}>
            {online ? "Online — accepting trips" : "Offline — not visible to riders"}
          </Text>
          <Text style={styles.statusSub}>
            {online
              ? "You will receive incoming ride requests."
              : "Go online to start earning."}
          </Text>
          <Pressable
            style={[styles.toggleBtn, online && styles.toggleBtnOnline]}
            onPress={() => setOnline((v) => !v)}
          >
            <Text style={styles.toggleTxt}>{online ? "Go Offline" : "Go Online"}</Text>
          </Pressable>
        </GlassCard>

        {online && (
          <PrimaryButton
            label="Find Ride Requests"
            onPress={() => router.push("/(driver)/requests")}
          />
        )}
      </View>

      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.md,
    gap: SPACE.sm,
  },
  statusCard: {
    alignItems: "center",
    gap: SPACE.sm,
    paddingVertical: SPACE.xl,
  },
  statusDot: {
    width: 16, height: 16, borderRadius: 8,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  statusDotOnline: {
    backgroundColor: "rgba(120,220,150,0.9)",
  },
  statusTitle: {
    color: COLORS.text, fontWeight: "900", fontSize: 16, textAlign: "center",
  },
  statusSub: {
    color: COLORS.textDim, fontSize: 13, textAlign: "center",
  },
  toggleBtn: {
    marginTop: SPACE.sm,
    paddingHorizontal: SPACE.xl,
    paddingVertical: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(255,255,255,0.1)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.15)",
  },
  toggleBtnOnline: {
    backgroundColor: "rgba(255,46,46,0.1)",
    borderColor: "rgba(255,46,46,0.3)",
  },
  toggleTxt: {
    color: COLORS.text, fontWeight: "900", fontSize: 15,
  },
});