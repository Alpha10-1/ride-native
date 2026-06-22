import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { Ride, getRideById, formatFare, TIER_CONFIG } from "../../src/lib/rides";
import { TripSlip, getTripSlip } from "../../src/lib/rides";

export default function RideCompleteScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const [ride, setRide] = useState<Ride | null>(null);
  const [slip, setSlip] = useState<TripSlip | null>(null);

  useEffect(() => {
    if (!rideId) return;
    getRideById(rideId).then((r) => { if (r) setRide(r); });
    // Poll briefly for slip — it's created server-side on completion
    const attempt = async (retries: number) => {
      const s = await getTripSlip(rideId);
      if (s) { setSlip(s); return; }
      if (retries > 0) setTimeout(() => attempt(retries - 1), 1000);
    };
    attempt(5);
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
  const tierCfg = TIER_CONFIG[ride.ride_tier ?? "economy"];

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm, paddingTop: SPACE.xl }}
        showsVerticalScrollIndicator={false}
      >
        {/* Status icon */}
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

        {/* Fare card */}
        {fare ? (
          <GlassCard style={styles.fareCard}>
            <Text style={styles.fareLabel}>
              {isCancelled ? "Cancellation Fee" : "Trip Fare"}
            </Text>
            <Text style={styles.fareAmount}>{formatFare(fare)}</Text>
            <View style={styles.tierBadge}>
              <Ionicons name={tierCfg.icon as any} size={13} color={COLORS.red} />
              <Text style={styles.tierBadgeTxt}>{tierCfg.label}</Text>
            </View>
          </GlassCard>
        ) : null}

        {/* Trip slip */}
        {slip && !isCancelled && (
          <GlassCard style={{ gap: SPACE.sm }}>
            <Text style={styles.slipTitle}>TRIP RECEIPT</Text>

            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>From</Text>
              <Text style={styles.slipVal} numberOfLines={2}>{slip.pickup_address}</Text>
            </View>
            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>To</Text>
              <Text style={styles.slipVal} numberOfLines={2}>{slip.destination_address}</Text>
            </View>

            <View style={styles.slipDivider} />

            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>Distance</Text>
              <Text style={styles.slipVal}>
                {slip.actual_distance_km ? `${slip.actual_distance_km.toFixed(1)} km` : "—"}
              </Text>
            </View>
            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>Duration</Text>
              <Text style={styles.slipVal}>
                {slip.actual_duration_min ? `${Math.round(slip.actual_duration_min)} min` : "—"}
              </Text>
            </View>
            <View style={styles.slipRow}>
              <Text style={styles.slipKey}>Ride type</Text>
              <Text style={styles.slipVal}>{tierCfg.label}</Text>
            </View>

            <View style={styles.slipDivider} />

            {slip.base_fare_cents ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Base fare</Text>
                <Text style={styles.slipVal}>{formatFare(slip.base_fare_cents)}</Text>
              </View>
            ) : null}
            {slip.demand_multiplier ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Demand</Text>
                <Text style={styles.slipVal}>{slip.demand_multiplier}×</Text>
              </View>
            ) : null}
            {slip.tier_multiplier && slip.tier_multiplier !== 1 ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Tier</Text>
                <Text style={styles.slipVal}>{slip.tier_multiplier}×</Text>
              </View>
            ) : null}
            {slip.booking_fee_cents ? (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Booking fee</Text>
                <Text style={styles.slipVal}>{formatFare(slip.booking_fee_cents)}</Text>
              </View>
            ) : null}

            <View style={styles.slipDivider} />

            <View style={styles.slipRow}>
              <Text style={[styles.slipKey, { color: COLORS.text, fontWeight: "900" }]}>Total</Text>
              <Text style={[styles.slipVal, { color: COLORS.text, fontWeight: "900", fontSize: 16 }]}>
                {slip.final_fare_cents ? formatFare(slip.final_fare_cents) : "—"}
              </Text>
            </View>

            {slip.driver_name && (
              <>
                <View style={styles.slipDivider} />
                <View style={styles.slipRow}>
                  <Text style={styles.slipKey}>Driver</Text>
                  <Text style={styles.slipVal}>{slip.driver_name}</Text>
                </View>
                {slip.driver_username && (
                  <View style={styles.slipRow}>
                    <Text style={styles.slipKey}>Username</Text>
                    <Text style={styles.slipVal}>@{slip.driver_username}</Text>
                  </View>
                )}
              </>
            )}

            {slip.completed_at && (
              <View style={styles.slipRow}>
                <Text style={styles.slipKey}>Date</Text>
                <Text style={styles.slipVal}>
                  {new Date(slip.completed_at).toLocaleString("en-ZA", {
                    dateStyle: "medium", timeStyle: "short",
                  })}
                </Text>
              </View>
            )}
          </GlassCard>
        )}

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
  title: { color: COLORS.text, fontWeight: "900", fontSize: 28, textAlign: "center", marginTop: SPACE.md },
  subtitle: { color: COLORS.textDim, fontSize: 14, textAlign: "center", lineHeight: 20 },
  fareCard: { alignItems: "center", gap: SPACE.xs },
  fareLabel: { color: COLORS.textFaint, fontSize: 11, textTransform: "uppercase", letterSpacing: 1.5, fontWeight: "800" },
  fareAmount: { color: COLORS.text, fontSize: 36, fontWeight: "900" },
  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,46,46,0.1)", borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(255,46,46,0.25)",
  },
  tierBadgeTxt: { color: COLORS.red, fontWeight: "800", fontSize: 12 },
  slipTitle: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  slipRow: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  slipKey: { color: COLORS.textFaint, fontSize: 13, flex: 1 },
  slipVal: { color: COLORS.textDim, fontSize: 13, flex: 2, textAlign: "right" },
  slipDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)" },
});