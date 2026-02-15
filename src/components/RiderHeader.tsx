import React from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";

export default function RiderHeader({
  title = "Ride",
  subtitle = "Where to?",
  onMenu,
  menuOpen,
  locationLabel,
  onPressLocation,
}: {
  title?: string;
  subtitle?: string;
  onMenu?: () => void;
  menuOpen?: boolean; // ✅ if true, shows X instead of burger
  locationLabel?: string; // ✅ optional pill label (e.g. "Pretoria")
  onPressLocation?: () => void; // ✅ click to update location
}) {
  return (
    <View style={styles.wrap}>
      <Pressable onPress={onMenu} style={styles.iconBtn} hitSlop={10}>
        <Ionicons
          name={menuOpen ? "close" : "menu"}
          size={20}
          color={COLORS.text}
        />
      </Pressable>

      <View style={{ flex: 1 }}>
        <Text style={styles.title}>
          <Text style={{ color: COLORS.text }}>R</Text>
          <Text style={{ color: COLORS.red }}>ide</Text>
        </Text>

        {/* If you pass locationLabel + onPressLocation, show pill.
            Otherwise fall back to the normal subtitle. */}
        {locationLabel && onPressLocation ? (
          <Pressable
            onPress={onPressLocation}
            style={({ pressed }) => [styles.pill, pressed && { opacity: 0.92 }]}
            hitSlop={10}
          >
            <Ionicons name="locate-outline" size={16} color={COLORS.red} />
            <Text style={styles.pillText} numberOfLines={1}>
              {locationLabel}
            </Text>
            <Ionicons
              name="refresh-outline"
              size={16}
              color="rgba(255,255,255,0.7)"
            />
          </Pressable>
        ) : (
          <Text style={styles.sub}>{subtitle}</Text>
        )}
      </View>

      {/* ✅ Settings removed (per your instruction) */}
      <View style={{ width: 44, height: 44 }} />
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: SPACE.md,
    paddingTop: SPACE.sm,
    paddingBottom: SPACE.sm,
    gap: 10,
  },
  title: {
    color: COLORS.text,
    fontSize: 26,
    fontWeight: "900",
    letterSpacing: -0.5,
  },
  sub: {
    color: COLORS.textDim,
    marginTop: 2,
    fontSize: 12,
    fontWeight: "700",
  },
  iconBtn: {
    width: 44,
    height: 44,
    borderRadius: RADIUS.pill,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },

  // ✅ pill styling matches your theme
  pill: {
    marginTop: 6,
    alignSelf: "flex-start",
    flexDirection: "row",
    alignItems: "center",
    gap: 10,
    paddingHorizontal: 12,
    paddingVertical: 9,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(0,0,0,0.55)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
    maxWidth: "90%",
  },
  pillText: {
    color: COLORS.text,
    fontSize: 12,
    fontWeight: "900",
    maxWidth: 220,
  },
});
