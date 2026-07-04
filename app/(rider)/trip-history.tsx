import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, TripSlip, RideStatus,
  getRideHistory, getTripSlip, formatFare, TIER_CONFIG,
} from "../../src/lib/rides";
import { supabase } from "../../src/lib/supabase";

function statusMeta(status: RideStatus): { label: string; color: string } {
  if (status === "cancelled") return { label: "Cancelled", color: "rgba(255,90,90,0.9)" };
  return { label: "Completed", color: "rgba(120,220,150,0.9)" };
}

export default function TripHistoryScreen() {
  const [loading, setLoading] = useState(true);
  const [rides, setRides] = useState<Ride[]>([]);
  const [userId, setUserId] = useState<string | null>(null);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [slips, setSlips] = useState<Record<string, TripSlip | null>>({});
  const [slipLoading, setSlipLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const { data: session } = await supabase.auth.getSession();
      setUserId(session.session?.user.id ?? null);
      const history = await getRideHistory(50);
      setRides(history);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load trip history.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const toggleExpand = async (ride: Ride) => {
    if (expandedId === ride.id) {
      setExpandedId(null);
      return;
    }
    setExpandedId(ride.id);
    if (ride.status === "completed" && slips[ride.id] === undefined) {
      setSlipLoading(ride.id);
      try {
        const slip = await getTripSlip(ride.id);
        setSlips((prev) => ({ ...prev, [ride.id]: slip }));
      } catch {
        setSlips((prev) => ({ ...prev, [ride.id]: null }));
      } finally {
        setSlipLoading(null);
      }
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Trip History" menuOpen={false} onMenu={() => router.back()} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Trip History" menuOpen={false} onMenu={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {rides.length === 0 && !error ? (
          <View style={styles.empty}>
            <Ionicons name="receipt-outline" size={48} color={COLORS.textFaint} />
            <Text style={styles.emptyTitle}>No trips yet</Text>
            <Text style={styles.emptySubtitle}>Your completed and cancelled trips will show up here.</Text>
          </View>
        ) : (
          rides.map((ride) => {
            const meta = statusMeta(ride.status);
            const tierCfg = TIER_CONFIG[ride.ride_tier ?? "economy"];
            const isDriverLeg = userId && ride.driver_id === userId;
            const fare = ride.status === "cancelled" ? ride.cancellation_fee_cents : ride.final_fare_cents;
            const expanded = expandedId === ride.id;
            const slip = slips[ride.id];

            return (
              <GlassCard key={ride.id} style={styles.rideCard}>
                <Pressable onPress={() => toggleExpand(ride)}>
                  <View style={styles.headRow}>
                    <View style={{ flex: 1, gap: 2 }}>
                      <Text style={styles.dateText}>
                        {new Date(ride.requested_at).toLocaleDateString("en-ZA", {
                          day: "numeric", month: "short", year: "numeric",
                        })}
                      </Text>
                      <View style={styles.locationRow}>
                        <View style={styles.dotPickup} />
                        <Text style={styles.locationText} numberOfLines={1}>{ride.pickup_address}</Text>
                      </View>
                      <View style={styles.locationRow}>
                        <Ionicons name="location" size={14} color={COLORS.red} />
                        <Text style={styles.locationText} numberOfLines={1}>{ride.destination_address}</Text>
                      </View>
                    </View>

                    <View style={{ alignItems: "flex-end", gap: 4 }}>
                      <Text style={styles.fareText}>{fare ? formatFare(fare) : "—"}</Text>
                      <View style={[styles.statusBadge, { borderColor: meta.color + "55" }]}>
                        <Text style={[styles.statusText, { color: meta.color }]}>{meta.label}</Text>
                      </View>
                    </View>
                  </View>

                  <View style={styles.footRow}>
                    <View style={styles.tierBadge}>
                      <Ionicons name={tierCfg.icon as any} size={12} color={COLORS.red} />
                      <Text style={styles.tierBadgeTxt}>{tierCfg.label}</Text>
                    </View>
                    {isDriverLeg ? (
                      <View style={styles.tierBadge}>
                        <Ionicons name="car-outline" size={12} color={COLORS.red} />
                        <Text style={styles.tierBadgeTxt}>As driver</Text>
                      </View>
                    ) : null}
                    <View style={{ flex: 1 }} />
                    <Ionicons
                      name={expanded ? "chevron-up" : "chevron-down"}
                      size={16}
                      color={COLORS.textFaint}
                    />
                  </View>
                </Pressable>

                {expanded && (
                  <View style={styles.receiptWrap}>
                    <View style={styles.slipDivider} />
                    {ride.status === "cancelled" ? (
                      <View style={{ gap: 6 }}>
                        <Text style={styles.slipTitle}>CANCELLATION DETAILS</Text>
                        <View style={styles.slipRow}>
                          <Text style={styles.slipKey}>Cancelled by</Text>
                          <Text style={styles.slipVal}>
                            {ride.cancelled_by === "driver" ? "Driver" : "Rider"}
                          </Text>
                        </View>
                        {ride.cancelled_at && (
                          <View style={styles.slipRow}>
                            <Text style={styles.slipKey}>Cancelled at</Text>
                            <Text style={styles.slipVal}>
                              {new Date(ride.cancelled_at).toLocaleString("en-ZA", {
                                dateStyle: "medium", timeStyle: "short",
                              })}
                            </Text>
                          </View>
                        )}
                        {ride.cancellation_fee_cents ? (
                          <View style={styles.slipRow}>
                            <Text style={[styles.slipKey, { color: COLORS.text, fontWeight: "900" }]}>Fee charged</Text>
                            <Text style={[styles.slipVal, { color: COLORS.text, fontWeight: "900" }]}>
                              {formatFare(ride.cancellation_fee_cents)}
                            </Text>
                          </View>
                        ) : (
                          <Text style={styles.emptySubtitle}>No cancellation fee was charged.</Text>
                        )}
                      </View>
                    ) : slipLoading === ride.id ? (
                      <View style={{ paddingVertical: SPACE.md, alignItems: "center" }}>
                        <ActivityIndicator color={COLORS.red} />
                      </View>
                    ) : slip ? (
                      <View style={{ gap: 6 }}>
                        <Text style={styles.slipTitle}>TRIP RECEIPT</Text>

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

                        {slip.driver_name && !isDriverLeg && (
                          <>
                            <View style={styles.slipDivider} />
                            <View style={styles.slipRow}>
                              <Text style={styles.slipKey}>Driver</Text>
                              <Text style={styles.slipVal}>{slip.driver_name}</Text>
                            </View>
                          </>
                        )}
                        {slip.rider_name && isDriverLeg && (
                          <>
                            <View style={styles.slipDivider} />
                            <View style={styles.slipRow}>
                              <Text style={styles.slipKey}>Rider</Text>
                              <Text style={styles.slipVal}>{slip.rider_name}</Text>
                            </View>
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
                      </View>
                    ) : (
                      <Text style={styles.emptySubtitle}>Receipt unavailable for this trip.</Text>
                    )}
                  </View>
                )}
              </GlassCard>
            );
          })
        )}
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  empty: { alignItems: "center", paddingTop: 80, gap: SPACE.sm },
  emptyTitle: { color: COLORS.text, fontWeight: "900", fontSize: 18 },
  emptySubtitle: { color: COLORS.textDim, fontSize: 13, textAlign: "center" },
  error: {
    color: "rgba(255,90,90,0.95)", marginTop: SPACE.sm,
    fontWeight: "700", textAlign: "center",
  },
  rideCard: { gap: SPACE.sm },
  headRow: { flexDirection: "row", gap: SPACE.sm },
  dateText: { color: COLORS.textFaint, fontSize: 11, fontWeight: "800", marginBottom: 2 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  locationText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  dotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.text, backgroundColor: "transparent",
  },
  fareText: { color: COLORS.text, fontWeight: "900", fontSize: 18 },
  statusBadge: {
    paddingHorizontal: 8, paddingVertical: 3, borderRadius: RADIUS.pill,
    borderWidth: 1, backgroundColor: "rgba(0,0,0,0.3)",
  },
  statusText: { fontSize: 10, fontWeight: "900", textTransform: "uppercase", letterSpacing: 0.5 },
  footRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4 },
  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,46,46,0.1)", borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(255,46,46,0.25)",
  },
  tierBadgeTxt: { color: COLORS.red, fontWeight: "800", fontSize: 11 },
  receiptWrap: { gap: 6 },
  slipTitle: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800", marginBottom: 2,
  },
  slipRow: { flexDirection: "row", justifyContent: "space-between", gap: SPACE.md },
  slipKey: { color: COLORS.textFaint, fontSize: 13, flex: 1 },
  slipVal: { color: COLORS.textDim, fontSize: 13, flex: 2, textAlign: "right" },
  slipDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)" },
});