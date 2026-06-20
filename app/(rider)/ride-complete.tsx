import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { Ride, getRideById, formatFare } from "../../src/lib/rides";

export default function RideCompleteScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [ride, setRide] = useState<Ride | null>(null);

  useEffect(() => {
    if (rideId) getRideById(rideId).then((r) => { if (r) setRide(r); });
  }, [rideId]);

  if (!ride) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Text style={{ color: COLORS.textDim }}>Loading...</Text>
        </View>
      </Screen>
    );
  }

  const isCancelled = ride.status === "cancelled";
  const fare = isCancelled ? ride.cancellation_fee_cents : ride.final_fare_cents;

  return (
    <Screen>
      <ScrollView contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm, paddingTop: SPACE.xl }}>
        <View style={styles.iconWrap}>
          <Ionicons
            name={isCancelled ? "close-circle" : "checkmark-circle"}
            size={64}
            color={isCancelled ? "rgba(255,90,90,0.9)" : "rgba(120,220,150,0.9)"}
          />
        </View>

        <Text style={styles.title}>
          {isCancelled ? "Ride Cancelled" : "You've arrived!"}
        </Text>
        <Text style={styles.subtitle}>
          {isCancelled
            ? ride.cancelled_by === "driver"
              ? "Your driver cancelled this trip."
              : "You cancelled this trip."
            : "Hope you enjoyed your ride."}
        </Text>

        {fare ? (
          <GlassCard style={styles.fareCard}>
            <Text style={styles.fareLabel}>
              {isCancelled ? "Cancellation Fee" : "Trip Fare"}
            </Text>
            <Text style={styles.fareAmount}>{formatFare(fare)}</Text>
            {!isCancelled && ride.actual_distance_km && ride.actual_duration_min ? (
              <Text style={styles.fareDetails}>
                {ride.actual_distance_km.toFixed(1)} km ·{" "}
                {Math.round(ride.actual_duration_min)} min ·{" "}
                {ride.demand_multiplier}× demand
              </Text>
            ) : null}
          </GlassCard>
        ) : null}

        <GlassCard style={{ gap: 8 }}>
          <View style={styles.detailRow}>
            <View style={styles.dotPickup} />
            <Text style={styles.detailText}>{ride.pickup_address}</Text>
          </View>
          <View style={styles.detailRow}>
            <Ionicons name="location" size={16} color={COLORS.red} />
            <Text style={styles.detailText}>{ride.destination_address}</Text>
          </View>
        </GlassCard>

        <PrimaryButton
          label="Back to Home"
          onPress={() => router.replace("/(rider)/home")}
        />
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  iconWrap: { alignItems: "center", marginTop: SPACE.xl },
  title: {
    color: COLORS.text, fontWeight: "900", fontSize: 28,
    textAlign: "center", marginTop: SPACE.md,
  },
  subtitle: {
    color: COLORS.textDim, fontSize: 14,
    textAlign: "center", lineHeight: 20,
  },
  fareCard: { alignItems: "center", gap: 4 },
  fareLabel: {
    color: COLORS.textFaint, fontSize: 11,
    textTransform: "uppercase", letterSpacing: 1.5, fontWeight: "800",
  },
  fareAmount: { color: COLORS.text, fontSize: 36, fontWeight: "900" },
  fareDetails: { color: COLORS.textDim, fontSize: 12 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  detailText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  dotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.text, backgroundColor: "transparent",
  },
});
