import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";
import {
  Ride, getPendingRideRequests, getActiveRideForDriver,
  acceptRide, formatFare,
} from "../../src/lib/rides";

export default function DriverRequestsScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<Ride[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // If driver already has an active ride, go straight to it
      const active = await getActiveRideForDriver();
      if (active) {
        router.replace({ pathname: "/(driver)/active-trip", params: { rideId: active.id } });
        return;
      }
      const pending = await getPendingRideRequests();
      setRequests(pending);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load requests.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Poll every 10s for new requests
  useEffect(() => {
    const interval = setInterval(load, 10000);
    return () => clearInterval(interval);
  }, [load]);

  const handleAccept = async (rideId: string) => {
    setAccepting(rideId);
    setError(null);
    try {
      await acceptRide(rideId);
      router.replace({ pathname: "/(driver)/active-trip", params: { rideId } });
    } catch (e: any) {
      setError(e?.message ?? "Failed to accept ride.");
      setAccepting(null);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Ride Requests" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Ride Requests" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        {requests.length === 0 ? (
          <View style={styles.empty}>
            <Ionicons name="car-outline" size={48} color={COLORS.textFaint} />
            <Text style={styles.emptyTitle}>No ride requests</Text>
            <Text style={styles.emptySubtitle}>New requests will appear here automatically.</Text>
          </View>
        ) : (
          requests.map((ride) => (
            <GlassCard key={ride.id} style={styles.rideCard}>
              <View style={styles.fareRow}>
                <Text style={styles.fareAmount}>
                  {ride.estimated_fare_cents ? formatFare(ride.estimated_fare_cents) : "—"}
                </Text>
                <Text style={styles.multiplier}>{ride.demand_multiplier}×</Text>
              </View>

              <View style={styles.locationBlock}>
                <View style={styles.locationRow}>
                  <View style={styles.dotPickup} />
                  <Text style={styles.locationText} numberOfLines={1}>{ride.pickup_address}</Text>
                </View>
                <View style={[styles.locationRow, { marginTop: 8 }]}>
                  <Ionicons name="location" size={16} color={COLORS.red} />
                  <Text style={styles.locationText} numberOfLines={1}>{ride.destination_address}</Text>
                </View>
              </View>

              {ride.estimated_distance_km && ride.estimated_duration_min ? (
                <Text style={styles.tripMeta}>
                  {ride.estimated_distance_km.toFixed(1)} km · {Math.round(ride.estimated_duration_min)} min
                </Text>
              ) : null}

              <PrimaryButton
                label={accepting === ride.id ? "Accepting..." : "Accept Ride"}
                onPress={() => handleAccept(ride.id)}
                disabled={!!accepting}
              />
            </GlassCard>
          ))
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 80, gap: SPACE.sm },
  emptyTitle: { color: COLORS.text, fontWeight: "900", fontSize: 18 },
  emptySubtitle: { color: COLORS.textDim, fontSize: 13, textAlign: "center" },
  rideCard: { gap: SPACE.sm },
  fareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fareAmount: { color: COLORS.text, fontWeight: "900", fontSize: 22 },
  multiplier: { color: COLORS.red, fontWeight: "900", fontSize: 14 },
  locationBlock: { gap: 4 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  locationText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  tripMeta: { color: COLORS.textFaint, fontSize: 12 },
  dotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.text, backgroundColor: "transparent",
  },
  error: {
    color: "rgba(255,90,90,0.95)", marginTop: SPACE.sm,
    fontWeight: "700", textAlign: "center",
  },
});