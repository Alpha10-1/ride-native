import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import { Ionicons } from "@expo/vector-icons";
import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import RowItem from "../../src/components/RowItem";
import { COLORS, RADIUS, SPACE } from "../../src/theme/tokens";

function BecomeDriverBanner() {
  return (
    <Pressable
      onPress={() => router.push("/(rider)/become-driver")}
      style={({ pressed }) => [
        styles.banner,
        pressed && { opacity: 0.92, transform: [{ scale: 0.995 }] },
      ]}
    >
      <View style={styles.bannerTop}>
        <View style={styles.bannerBadge}>
          <Ionicons name="flash" size={14} color={COLORS.red} />
          <Text style={styles.bannerBadgeText}>EARN WITH US</Text>
        </View>

        <View style={styles.bannerCta}>
          <Text style={styles.bannerCtaText}>APPLY</Text>
        </View>
      </View>

      <Text style={styles.bannerTitle}>BECOME A DRIVER</Text>
      <Text style={styles.bannerSub}>Apply in minutes and start taking trips.</Text>
    </Pressable>
  );
}

export default function RiderMenu() {
  return (
    <Screen>
      <RiderHeader subtitle="Menu" menuOpen onMenu={() => router.back()} />

      <View style={styles.wrap}>
        <BecomeDriverBanner />

        <RowItem
          title="Profile"
          subtitle="Name, phone, email"
          icon="person-outline"
          onPress={() => router.push("/(rider)/profile")}
        />

        <RowItem
          title="Book a Ride"
          subtitle="Request a ride"
          icon="car-outline"
          onPress={() => router.replace("/(rider)/home")}
        />

        <RowItem
          title="Promotions"
          subtitle="Discounts & offers"
          icon="pricetag-outline"
          onPress={() => router.push("/(rider)/promotions")}
        />

        <RowItem
          title="Ride credits"
          subtitle="Wallet & credits"
          icon="wallet-outline"
          onPress={() => router.push("/(rider)/credits")}
        />

        <RowItem
          title="Settings"
          subtitle="Account, safety, preferences"
          icon="settings-outline"
          onPress={() => router.push("/(rider)/settings")}
        />

        <RowItem
          title="Help & Support"
          subtitle="Help & contact"
          icon="help-circle-outline"
          onPress={() => router.push("/(rider)/support")}
        />

        <RowItem
          title="Sign Out"
          subtitle="Log out of your account"
          icon="log-out-outline"
          danger
          showChevron={false}
          onPress={() => {
            // TODO: wire to auth sign out
            // Example:
            // await auth.signOut();
            // router.replace("/(auth)/login");
          }}
        />

        <Text style={{ color: "rgba(255,255,255,0.55)", marginTop: 10 }}>
          Demo build
        </Text>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  wrap: { paddingHorizontal: SPACE.md, gap: SPACE.sm, paddingBottom: 120 },

  banner: {
    padding: 16,
    borderRadius: RADIUS.xl,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    overflow: "hidden",
  },
  bannerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  bannerBadge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: "rgba(255,0,0,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.18)",
  },
  bannerBadgeText: {
    color: COLORS.red,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.6,
  },
  bannerCta: {
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    backgroundColor: "rgba(255,0,0,0.14)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.20)",
  },
  bannerCtaText: {
    color: COLORS.red,
    fontWeight: "900",
    fontSize: 12,
    letterSpacing: 0.6,
  },
  bannerTitle: {
    marginTop: 10,
    color: COLORS.text,
    fontWeight: "900",
    fontSize: 16,
  },
  bannerSub: {
    marginTop: 4,
    color: COLORS.textDim,
    fontSize: 12,
  },
});
