import React, { useEffect, useRef } from "react";
import {
  Animated,
  Dimensions,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from "react-native";
import { BlurView } from "expo-blur";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import RowItem from "./RowItem";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";
import { logout } from "../lib/auth";

function BecomeDriverBanner({ onPress }: { onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.banner, pressed && { opacity: 0.92 }]}
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

export default function SideMenuDrawer({
  open,
  onClose,
  role = "rider",
  widthPct = 0.55,
}: {
  open: boolean;
  onClose: () => void;
  role?: "rider" | "driver";
  widthPct?: number;
}) {
  const { width: W, height: H } = Dimensions.get("window");
  const panelW = Math.min(Math.max(W * widthPct, 260), 420);

  const translateX = useRef(new Animated.Value(-panelW)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(translateX, {
        toValue: open ? 0 : -panelW,
        duration: 220,
        useNativeDriver: true,
      }),
      Animated.timing(backdrop, {
        toValue: open ? 1 : 0,
        duration: 220,
        useNativeDriver: true,
      }),
    ]).start();
  }, [open, panelW, translateX, backdrop]);

  const isDriver = role === "driver";
  const base = isDriver ? "/(driver)" : "/(rider)";

  return (
    <View
      pointerEvents={open ? "auto" : "none"}
      style={[StyleSheet.absoluteFill, { zIndex: 999 }]}
    >
      {/* Backdrop (blur + dim). Tap to close */}
      <Animated.View style={[StyleSheet.absoluteFill, { opacity: backdrop }]}>
        <BlurView intensity={35} tint="dark" style={StyleSheet.absoluteFill} />
        <Pressable onPress={onClose} style={[StyleSheet.absoluteFill, styles.dim]} />
      </Animated.View>

      {/* Solid panel */}
      <Animated.View
        style={[
          styles.panel,
          {
            width: panelW,
            height: H,
            transform: [{ translateX }],
          },
        ]}
      >
        <View style={styles.panelTop}>
          <Text style={styles.panelTitle}>
            <Text style={{ color: COLORS.text }}>R</Text>
            <Text style={{ color: COLORS.red }}>ide</Text>
          </Text>
        </View>

        <ScrollView
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingHorizontal: SPACE.md, gap: SPACE.sm, paddingBottom: SPACE.xl }}
          showsVerticalScrollIndicator={false}
        >
          {!isDriver && (
            <BecomeDriverBanner
              onPress={() => {
                onClose();
                router.push("/(rider)/become-driver");
              }}
            />
          )}

          <RowItem
            title="Profile"
            subtitle="Name, phone, email"
            icon="person-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/profile`);
            }}
          />

          {isDriver ? (
            <RowItem
              title="Go Online"
              subtitle="Start accepting trips"
              icon="car-outline"
              onPress={() => {
                onClose();
                router.push("/(driver)/requests");
              }}
            />
          ) : (
            <RowItem
              title="Book a Ride"
              subtitle="Request a ride"
              icon="car-outline"
              onPress={() => {
                onClose();
                router.push("/(rider)/booking");
              }}
            />
          )}

          <RowItem
            title="Promotions"
            subtitle="Discounts & offers"
            icon="pricetag-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/promotions`);
            }}
          />

          {!isDriver && (
            <RowItem
              title="Trip History"
              subtitle="Past rides & receipts"
              icon="time-outline"
              onPress={() => {
                onClose();
                router.push("/(rider)/trip-history");
              }}
            />
          )}

          <RowItem
            title={isDriver ? "Earnings" : "Ride credits"}
            subtitle={isDriver ? "Wallet & payouts" : "Wallet & credits"}
            icon="wallet-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/wallet`);
            }}
          />

          <RowItem
            title="Settings"
            subtitle="Account, safety, preferences"
            icon="settings-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/settings`);
            }}
          />

          <RowItem
            title="Help & Support"
            subtitle="Help & contact"
            icon="help-circle-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/support`);
            }}
          />

          <RowItem
            title="Sign Out"
            subtitle="Log out of your account"
            icon="log-out-outline"
            danger
            showChevron={false}
            onPress={() => {
              onClose();
              logout().finally(() => router.replace("/auth/login"));
            }}
          />
        </ScrollView>
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  dim: { backgroundColor: "rgba(0,0,0,0.35)" },

  panel: {
    position: "absolute",
    left: 0,
    top: 0,
    backgroundColor: "#070707", // ✅ solid panel (not transparent)
    borderRightWidth: 1,
    borderRightColor: "rgba(255,255,255,0.10)",
    paddingTop: SPACE.sm,
  },

  panelTop: {
    paddingHorizontal: SPACE.md,
    paddingBottom: SPACE.sm,
  },
  panelTitle: {
    fontSize: 24,
    fontWeight: "900",
    letterSpacing: -0.5,
  },

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