import React, { useEffect, useRef, useState } from "react";
import {
  Alert,
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
import { getMyDriverStatus, applyToDrive, switchActiveMode } from "../lib/driverApplication";
import { resetTo } from "../lib/navigation";

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
  online = false,
  onToggleOnline,
}: {
  open: boolean;
  onClose: () => void;
  role?: "rider" | "driver";
  widthPct?: number;
  online?: boolean;
  onToggleOnline?: () => void;
}) {
  const { width: W, height: H } = Dimensions.get("window");
  const panelW = Math.min(Math.max(W * widthPct, 260), 420);

  const translateX = useRef(new Animated.Value(-panelW)).current;
  const backdrop = useRef(new Animated.Value(0)).current;

  // Whether this account has already provided driver info at all
  // (independent of which side of the app they're currently viewing) —
  // decides whether the rider side shows the full "Apply" banner or just
  // a quick "Switch to Driver" row, and lets the banner's press handler
  // know whether to jump straight into registration.
  const [isRegisteredDriver, setIsRegisteredDriver] = useState(false);
  const [switching, setSwitching] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    getMyDriverStatus()
      .then((status) => {
        if (!cancelled) setIsRegisteredDriver(status.isDriver);
      })
      .catch(() => {
        // Non-critical — worst case the banner shows a beat longer than
        // it needs to; the press handler re-checks anyway.
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const handleApply = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      onClose();
      await applyToDrive();
    } catch (e: any) {
      Alert.alert("Couldn't switch to driver mode", e?.message ?? "Please try again.");
    } finally {
      setSwitching(false);
    }
  };

  const handleSwitchToRider = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      onClose();
      await switchActiveMode("rider");
      resetTo("/(rider)/home");
    } catch (e: any) {
      Alert.alert("Couldn't switch to rider mode", e?.message ?? "Please try again.");
    } finally {
      setSwitching(false);
    }
  };

  const isDriver = role === "driver";
  const base = isDriver ? "/(driver)" : "/(rider)";

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
          {!isDriver && !isRegisteredDriver && (
            <BecomeDriverBanner onPress={handleApply} />
          )}

          {!isDriver && isRegisteredDriver && (
            <RowItem
              title="Switch to Driver"
              subtitle="Go online and take trips"
              icon="car-sport-outline"
              showChevron={false}
              onPress={handleApply}
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
            <>
              <RowItem
                title={online ? "Go Offline" : "Go Online"}
                subtitle={online ? "Stop accepting trips" : "Start accepting trips"}
                icon={online ? "power" : "car-outline"}
                danger={online}
                showChevron={false}
                onPress={() => {
                  if (onToggleOnline) {
                    onToggleOnline();
                    onClose();
                  } else {
                    onClose();
                    // Same screen already, but resetTo (not push) so
                    // repeatedly tapping this can't stack up duplicate
                    // driver-home entries that pile up in back history.
                    resetTo("/(driver)/home");
                  }
                }}
              />
              <RowItem
                title="Switch to Rider"
                subtitle="Book a trip instead"
                icon="person-outline"
                showChevron={false}
                onPress={handleSwitchToRider}
              />
            </>
          ) : (
            <RowItem
              title="Book a Ride"
              subtitle="Request a ride"
              icon="car-outline"
              onPress={() => {
                onClose();
                // resetTo, not push — this is already the screen
                // underneath the menu most of the time. Pushing a
                // duplicate on top of itself is how repeatedly tapping
                // this row (or the equivalent Go Online row above) used
                // to leave a growing pile of same-portal entries in back
                // history — noticeable as "back button eventually shows
                // a screen from the wrong portal" once combined with any
                // earlier driver/rider mode switch in the same session.
                resetTo("/(rider)/home");
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

          <RowItem
            title="Trip History"
            subtitle="Past rides & receipts"
            icon="time-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/trip-history`);
            }}
          />


          <RowItem
            title={isDriver ? "Earnings" : "Ride credits"}
            subtitle={isDriver ? "Wallet & payouts" : "Wallet & credits"}
            icon="wallet-outline"
            onPress={() => {
              onClose();
              router.push(`${base}/wallet`);
            }}
          />

          {!isDriver && (
            <RowItem
              title="Payment Methods"
              subtitle="Wallet, card, or cash"
              icon="card-outline"
              onPress={() => {
                onClose();
                router.push("/(rider)/payment-methods");
              }}
            />
          )}

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
              logout().finally(() => resetTo("/auth/login"));
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