import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { Alert } from "../../src/lib/themedAlert";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, getMyScheduledRides, getActiveRideForRider, cancelRide, formatFare, TIER_CONFIG,
} from "../../src/lib/rides";

export default function ScheduledRidesScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [rides, setRides] = useState<Ride[]>([]);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      // If one of these has activated in the meantime, jump straight into it.
      const active = await getActiveRideForRider();
      if (active) {
        router.replace({ pathname: "/(rider)/ride-tracking", params: { rideId: active.id } });
        return;
      }
      const list = await getMyScheduledRides();
      setRides(list);
    } catch {
      // keep showing whatever we last had
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleCancel = (rideId: string) => {
    Alert.alert("Cancel scheduled ride?", "This can't be undone.", [
      { text: "Keep it", style: "cancel" },
      {
        text: "Cancel Ride",
        style: "destructive",
        onPress: async () => {
          setCancelling(rideId);
          try {
            await cancelRide(rideId);
            setRides((prev) => prev.filter((r) => r.id !== rideId));
          } catch (e: any) {
            Alert.alert("Couldn't cancel", e?.message ?? "Please try again.");
          } finally {
            setCancelling(null);
          }
        },
      },
    ]);
  };

  return (
    <Screen>
      <RiderHeader subtitle="Scheduled Rides" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      {loading ? (
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      ) : (
        <ScrollView contentContainerStyle={{ padding: SPACE.md, gap: SPACE.sm }}>
          {rides.length === 0 ? (
            <View style={styles.centerFill}>
              <Ionicons name="calendar-outline" size={32} color={COLORS.textFaint} />
              <Text style={styles.emptyTxt}>No scheduled rides yet</Text>
            </View>
          ) : (
            rides.map((ride) => {
              const when = ride.scheduled_for ? new Date(ride.scheduled_for) : null;
              return (
                <GlassCard key={ride.id} style={{ gap: 10 }}>
                  {when && (
                    <View style={styles.whenRow}>
                      <Ionicons name="time-outline" size={14} color={COLORS.red} />
                      <Text style={styles.whenTxt}>
                        {when.toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" })}
                        {" · "}
                        {when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                      </Text>
                      <Text style={styles.tierChip}>{TIER_CONFIG[ride.ride_tier].label}</Text>
                    </View>
                  )}
                  <View style={styles.locationRow}>
                    <View style={styles.dotPickup} />
                    <Text style={styles.locationText} numberOfLines={1}>{ride.pickup_address}</Text>
                  </View>
                  <View style={styles.locationRow}>
                    <Ionicons name="location" size={16} color={COLORS.red} />
                    <Text style={styles.locationText} numberOfLines={1}>{ride.destination_address}</Text>
                  </View>
                  <View style={styles.footerRow}>
                    <Text style={styles.fareTxt}>
                      {ride.estimated_fare_cents ? formatFare(ride.estimated_fare_cents) : "—"}
                    </Text>
                    <Pressable
                      style={styles.cancelBtn}
                      disabled={cancelling === ride.id}
                      onPress={() => handleCancel(ride.id)}
                    >
                      <Text style={styles.cancelTxt}>{cancelling === ride.id ? "..." : "Cancel"}</Text>
                    </Pressable>
                  </View>
                </GlassCard>
              );
            })
          )}
        </ScrollView>
      )}
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center", paddingTop: 100, gap: 10 },
  emptyTxt: { color: COLORS.textFaint, fontSize: 13 },
  whenRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  whenTxt: { color: COLORS.text, fontWeight: "900", fontSize: 14, flex: 1 },
  tierChip: {
    color: COLORS.textDim, fontSize: 11, fontWeight: "800",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  locationRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  dotPickup: { width: 10, height: 10, borderRadius: 5, backgroundColor: COLORS.text },
  locationText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  footerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", marginTop: 4 },
  fareTxt: { color: COLORS.red, fontWeight: "900", fontSize: 16 },
  cancelBtn: {
    height: 34, paddingHorizontal: 14, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
    alignItems: "center", justifyContent: "center",
  },
  cancelTxt: { color: COLORS.textDim, fontWeight: "800", fontSize: 12 },
});