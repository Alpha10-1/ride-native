import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable } from "react-native";
import { router } from "expo-router";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import PrimaryButton from "../../src/components/PrimaryButton";
import SwipeableSheet from "../../src/components/SwipeableSheet";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import RiderHeader from "../../src/components/RiderHeader";
import Mapbox from "@rnmapbox/maps";

function LocationPill({
  label,
  loading,
  onPress,
}: {
  label: string;
  loading?: boolean;
  onPress?: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => [pillStyles.pill, pressed && { opacity: 0.92 }]}
    >
      <View style={pillStyles.badge}>
        <Ionicons name="business-outline" size={18} color={COLORS.red} />
      </View>

      <Text style={pillStyles.text} numberOfLines={1}>
        {loading ? "Locating..." : label}
      </Text>

      <View style={pillStyles.chevWrap}>
        <Ionicons name="chevron-down" size={16} color={COLORS.text} />
      </View>
    </Pressable>
  );
}

const pillStyles = StyleSheet.create({
  pill: {
    position: "absolute",
    top: SPACE.sm,
    alignSelf: "center",

    // 🔥 shrink-wrap to content (no fixed width)
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
    borderRadius: RADIUS.pill,
    backgroundColor: "rgba(0,0,0,0.70)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.35)",

    // floating shadow
    shadowColor: "#000",
    shadowOpacity: 0.35,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 8 },
    elevation: 8,

    // ✅ safety so long names don't take the whole screen
    maxWidth: "92%",
  },
  badge: {
    width: 40,
    height: 40,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,0,0,0.10)",
    borderWidth: 1,
    borderColor: "rgba(255,0,0,0.25)",
  },
  text: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "900",
    maxWidth: 220, // keeps "Pietermaritzburg" fine, prevents super-long overflow
  },
  chevWrap: {
    width: 34,
    height: 34,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
});

export default function RiderHome() {
  const [pickup, setPickup] = useState("");
  const [menuOpen, setMenuOpen] = useState(false);
  const [dropoff, setDropoff] = useState("");
  const [tab, setTab] = useState<"home" | "work" | "recent" | "safety">("home");
  const [currentCityOrArea, setCurrentCityOrArea] = useState<string>(
    "Current location"
  );
  const [locLoading, setLocLoading] = useState(false);

  const refreshUserLocation = async () => {
    try {
      setLocLoading(true);

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        setCurrentCityOrArea("Location permission needed");
        return;
      }

      const pos = await Location.getCurrentPositionAsync({
        accuracy: Location.Accuracy.Balanced,
      });

      const geos = await Location.reverseGeocodeAsync({
        latitude: pos.coords.latitude,
        longitude: pos.coords.longitude,
      });

      const g = geos?.[0];
      const label =
        g?.city ||
        g?.subregion ||
        g?.district ||
        g?.region ||
        g?.country ||
        "Current location";

      setCurrentCityOrArea(label);
    } catch {
      setCurrentCityOrArea("Couldn’t update location");
    } finally {
      setLocLoading(false);
    }
  };

  useEffect(() => {
    refreshUserLocation();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);


  return (
    <Screen>
      <RiderHeader
        subtitle="Where to?"
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
      />

      {/* ✅ Real Mapbox map area */}
      <View style={styles.mapArea}>
        <Mapbox.MapView
          style={StyleSheet.absoluteFillObject}
          logoEnabled={false}
          attributionEnabled={false}
          compassEnabled={true}
          scaleBarEnabled={false}
        >
          <Mapbox.Camera
            zoomLevel={12}
            centerCoordinate={[28.0473, -26.2041]} // Johannesburg (lng, lat)
            animationMode="flyTo"
            animationDuration={800}
          />
        </Mapbox.MapView>

        {/* ✅ Floating location pill overlay */}
        <LocationPill
          label={currentCityOrArea}
          loading={locLoading}
          onPress={refreshUserLocation}
        />
      </View>

      <SwipeableSheet handleHeight={56} topGap={180} onTabChange={setTab}>
        <View style={{ gap: SPACE.sm }}>
          {tab !== "safety" && (
            <>
              <GlassCard>
                <Text style={styles.sheetTitle}>Where are you going?</Text>
                <Text style={styles.sheetSub}>
                  Enter pickup and destination to request a ride.
                </Text>
              </GlassCard>

              <View style={{ gap: SPACE.sm }}>
                <TextField
                  placeholder={
                    tab === "home"
                      ? "Pickup location (Home)"
                      : tab === "work"
                      ? "Pickup location (Work)"
                      : "Pickup location"
                  }
                  value={pickup}
                  onChangeText={setPickup}
                />
                <TextField
                  placeholder="Destination"
                  value={dropoff}
                  onChangeText={setDropoff}
                />
              </View>

              <PrimaryButton
                label="Request Ride"
                onPress={() => router.push("/(rider)/trip")}
                disabled={!pickup.trim() || !dropoff.trim()}
              />
            </>
          )}

          {tab === "recent" && (
            <GlassCard>
              <Text style={styles.sheetTitle}>Recent</Text>
              <Text style={styles.sheetSub}>Your recent trips will appear here.</Text>
            </GlassCard>
          )}

          {tab === "safety" && (
            <View style={{ gap: SPACE.sm }}>
              <GlassCard>
                <Text style={styles.sheetTitle}>Safety</Text>
                <Text style={styles.sheetSub}>
                  Quick actions to keep you safe during a ride.
                </Text>
              </GlassCard>

              <View style={{ gap: SPACE.sm }}>
                <PrimaryButton label="Emergency" onPress={() => {}} />
                <PrimaryButton label="Share Trip" onPress={() => {}} />
                <PrimaryButton label="Safety Check" onPress={() => {}} />
              </View>
            </View>
          )}
        </View>
      </SwipeableSheet>

      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} />
    </Screen>
  );

}

const styles = StyleSheet.create({
  mapArea: { flex: 1, paddingHorizontal: SPACE.md, paddingBottom: 120 },
  mapFake: {
    flex: 1,
    borderRadius: RADIUS.xl,
    backgroundColor: "rgba(255,255,255,0.03)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)",
    alignItems: "center",
    justifyContent: "center",
  },
  mapText: { color: COLORS.text, fontSize: 18, fontWeight: "900" },
  mapSub: { color: COLORS.textDim, marginTop: 6 },

  sheetTitle: { color: COLORS.text, fontSize: 16, fontWeight: "900" },
  sheetSub: { color: COLORS.textDim, marginTop: 6, fontSize: 12 },

  quickRow: { flexDirection: "row", gap: 10, marginTop: 6 },
  quickChip: {
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 999,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.10)",
  },
  quickTxt: { color: COLORS.text, fontWeight: "800" },
});
