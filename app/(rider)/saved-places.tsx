import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert } from "react-native";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import RowItem from "../../src/components/RowItem";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { getSavedPlaces, deleteSavedPlace, SavedPlace } from "../../src/lib/savedPlaces";

export default function SavedPlacesScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [places, setPlaces] = useState<SavedPlace[]>([]);

  const load = useCallback(async () => {
    try {
      const data = await getSavedPlaces();
      setPlaces(data);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load saved places.");
    } finally {
      setLoading(false);
    }
  }, []);

  // Reload whenever the screen comes back into focus (e.g. after adding a
  // place via the map picker and navigating back).
  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const home = places.find((p) => p.kind === "home");
  const work = places.find((p) => p.kind === "work");
  const customs = places.filter((p) => p.kind === "custom");

  const handleDeleteCustom = (place: SavedPlace) => {
    Alert.alert("Remove favourite", `Remove "${place.label}" from your saved places?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteSavedPlace(place.id);
            setPlaces((prev) => prev.filter((p) => p.id !== place.id));
          } catch (e: any) {
            setError(e?.message ?? "Failed to remove place.");
          }
        },
      },
    ]);
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Saved Places" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Saved Places" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard>
          <Text style={styles.kicker}>SAVED PLACES</Text>
          <Text style={styles.sub}>Set your Home and Work for quick access, and save favourite spots.</Text>
        </GlassCard>

        <Text style={styles.section}>Fixed Places</Text>
        <RowItem
          icon="home-outline"
          title="Home"
          subtitle={home ? home.address : "Not set"}
          onPress={() => router.push({ pathname: "/(rider)/saved-place-picker", params: { kind: "home" } })}
        />
        <RowItem
          icon="briefcase-outline"
          title="Work"
          subtitle={work ? work.address : "Not set"}
          onPress={() => router.push({ pathname: "/(rider)/saved-place-picker", params: { kind: "work" } })}
        />

        <Text style={styles.section}>Favourites</Text>
        {customs.length === 0 ? (
          <Text style={styles.empty}>No custom favourites yet.</Text>
        ) : (
          customs.map((place) => (
            <RowItem
              key={place.id}
              icon="star-outline"
              title={place.label}
              subtitle={place.address}
              showChevron={false}
              onPress={() => handleDeleteCustom(place)}
            />
          ))
        )}

        <View style={{ marginTop: SPACE.sm }}>
          <RowItem
            icon="add-circle-outline"
            title="Add a favourite"
            subtitle="Save a new place"
            onPress={() => router.push({ pathname: "/(rider)/saved-place-picker", params: { kind: "custom" } })}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
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
  empty: {
    color: COLORS.textFaint,
    fontSize: 13,
    paddingVertical: SPACE.sm,
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});