import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, TextInput, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, getPendingRideRequests, getActiveRideForDriver,
  acceptRide, formatFare, getRideStops,
} from "../../src/lib/rides";
import {
  RideOffer, getRideOffers, proposeOffer, respondToOffer,
} from "../../src/lib/negotiation";
import { reserveRideCard } from "../../src/lib/payments";

export default function DriverRequestsScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [requests, setRequests] = useState<Ride[]>([]);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fare negotiation: since RLS scopes ride_offers to the caller's own
  // thread, a driver querying getRideOffers(rideId) always gets back just
  // their own back-and-forth on that ride. A driver can only make an offer
  // once the rider has broadcast a proposed fare (ride.rider_proposed_fare_cents)
  // — drivers can never start a negotiation from scratch.
  const [offersByRide, setOffersByRide] = useState<Record<string, RideOffer[]>>({});
  const [negotiatingRide, setNegotiatingRide] = useState<string | null>(null);
  const [offerInput, setOfferInput] = useState("");
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [stopCounts, setStopCounts] = useState<Record<string, number>>({});

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

      const entries = await Promise.all(
        pending.map(async (r) => [r.id, await getRideOffers(r.id).catch(() => [])] as const)
      );
      setOffersByRide(Object.fromEntries(entries));

      const stopEntries = await Promise.all(
        pending.map(async (r) => [r.id, (await getRideStops(r.id).catch(() => [])).length] as const)
      );
      setStopCounts(Object.fromEntries(stopEntries));
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
      reserveRideCard(rideId).catch((e: any) => {
        console.warn("[driver/requests] reserveRideCard failed:", e?.message ?? e);
      });
    } catch (e: any) {
      setError(e?.message ?? "Failed to accept ride.");
      setAccepting(null);
    }
  };

  const handleSendOffer = async (rideId: string) => {
    const amount = Math.round(parseFloat(offerInput) * 100);
    if (!amount || amount <= 0) {
      Alert.alert("Enter an amount", "Please enter a valid offer amount.");
      return;
    }
    setOfferBusy(rideId);
    try {
      const offer = await proposeOffer(rideId, amount);
      setOffersByRide((prev) => ({ ...prev, [rideId]: [...(prev[rideId] ?? []), offer] }));
      setNegotiatingRide(null);
      setOfferInput("");
    } catch (e: any) {
      Alert.alert("Couldn't send offer", e?.message ?? "Please try again.");
    } finally {
      setOfferBusy(null);
    }
  };

  const handleRespond = async (rideId: string, offerId: string, approve: boolean) => {
    setOfferBusy(rideId);
    try {
      const updated = await respondToOffer(offerId, approve);
      if (approve) {
        router.replace({ pathname: "/(driver)/active-trip", params: { rideId } });
        return;
      }
      setOffersByRide((prev) => ({
        ...prev,
        [rideId]: (prev[rideId] ?? []).map((o) => (o.id === updated.id ? updated : o)),
      }));
    } catch (e: any) {
      Alert.alert("Couldn't respond", e?.message ?? "Please try again.");
    } finally {
      setOfferBusy(null);
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
          requests.map((ride) => {
            const thread = offersByRide[ride.id] ?? [];
            const latest = thread.length ? thread[thread.length - 1] : null;
            const pendingOffer = latest?.status === "pending" ? latest : null;
            const isNegotiating = negotiatingRide === ride.id;
            const busy = offerBusy === ride.id;

            return (
              <GlassCard key={ride.id} style={styles.rideCard}>
                <View style={styles.fareRow}>
                  <Text style={styles.fareAmount}>
                    {ride.estimated_fare_cents ? formatFare(ride.estimated_fare_cents) : "—"}
                  </Text>
                  <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                    {stopCounts[ride.id] > 0 && (
                      <View style={styles.stopBadge}>
                        <Ionicons name="git-branch-outline" size={11} color={COLORS.textDim} />
                        <Text style={styles.stopBadgeTxt}>
                          {stopCounts[ride.id]} stop{stopCounts[ride.id] > 1 ? "s" : ""}
                        </Text>
                      </View>
                    )}
                    <Text style={styles.multiplier}>{ride.demand_multiplier}×</Text>
                  </View>
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

                {pendingOffer?.proposed_by === "rider" ? (
                  // Rider countered — driver can accept, decline, or counter back.
                  <View style={styles.negotiationBox}>
                    <Text style={styles.negotiationTxt}>
                      Rider countered with <Text style={{ fontWeight: "900" }}>{formatFare(pendingOffer.amount_cents)}</Text>
                    </Text>
                    <View style={styles.negotiationBtnRow}>
                      <Pressable
                        style={[styles.smallBtn, styles.smallBtnGhost]}
                        disabled={busy}
                        onPress={() => handleRespond(ride.id, pendingOffer.id, false)}
                      >
                        <Text style={styles.smallBtnGhostTxt}>Decline</Text>
                      </Pressable>
                      <Pressable
                        style={[styles.smallBtn, styles.smallBtnFilled]}
                        disabled={busy}
                        onPress={() => handleRespond(ride.id, pendingOffer.id, true)}
                      >
                        <Text style={styles.smallBtnFilledTxt}>
                          {busy ? "..." : `Accept ${formatFare(pendingOffer.amount_cents)}`}
                        </Text>
                      </Pressable>
                    </View>
                  </View>
                ) : pendingOffer?.proposed_by === "driver" ? (
                  // Driver's own offer, awaiting the rider's response.
                  <View style={styles.negotiationBox}>
                    <Ionicons name="time-outline" size={14} color={COLORS.textDim} />
                    <Text style={styles.negotiationTxt}>
                      Your offer of {formatFare(pendingOffer.amount_cents)} is awaiting the rider
                    </Text>
                  </View>
                ) : null}

                {!pendingOffer && ride.rider_proposed_fare_cents ? (
                  // Rider has broadcast a proposed fare on this ride — that's
                  // the only way a negotiation can start. The driver can
                  // accept it as-is or send a different counter.
                  <View style={styles.negotiationBox}>
                    <Text style={styles.negotiationTxt}>
                      Rider proposed <Text style={{ fontWeight: "900" }}>{formatFare(ride.rider_proposed_fare_cents)}</Text>
                    </Text>
                  </View>
                ) : null}

                {isNegotiating ? (
                  <View style={styles.offerInputRow}>
                    <TextInput
                      value={offerInput}
                      onChangeText={setOfferInput}
                      placeholder="Your price (R)"
                      placeholderTextColor={COLORS.textFaint}
                      keyboardType="decimal-pad"
                      style={styles.offerInput}
                      autoFocus
                    />
                    <Pressable
                      style={[styles.smallBtn, styles.smallBtnFilled]}
                      disabled={busy}
                      onPress={() => handleSendOffer(ride.id)}
                    >
                      <Text style={styles.smallBtnFilledTxt}>{busy ? "..." : "Send"}</Text>
                    </Pressable>
                  </View>
                ) : null}

                <PrimaryButton
                  label={accepting === ride.id ? "Accepting..." : "Accept Ride"}
                  onPress={() => handleAccept(ride.id)}
                  disabled={!!accepting}
                />

                {/* Only shown once the rider has opened negotiation on this
                    ride — a driver can never start one from scratch. */}
                {!pendingOffer && !isNegotiating && ride.rider_proposed_fare_cents ? (
                  <Pressable
                    onPress={() => {
                      setNegotiatingRide(ride.id);
                      setOfferInput(String((ride.rider_proposed_fare_cents! / 100).toFixed(2)));
                    }}
                  >
                    <Text style={styles.makeOfferLink}>
                      Accept {formatFare(ride.rider_proposed_fare_cents)} or send a counter
                    </Text>
                  </Pressable>
                ) : null}
              </GlassCard>
            );
          })
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
  negotiationBox: {
    flexDirection: "row", alignItems: "center", flexWrap: "wrap", gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.md, padding: 10,
  },
  negotiationTxt: { color: COLORS.textDim, fontSize: 13, flexShrink: 1 },
  negotiationBtnRow: { flexDirection: "row", gap: 8, marginLeft: "auto" },
  offerInputRow: { flexDirection: "row", gap: 8 },
  offerInput: {
    flex: 1, color: COLORS.text, fontSize: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.md, paddingHorizontal: 14, height: 44,
  },
  smallBtn: { height: 40, minWidth: 76, paddingHorizontal: 12, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center" },
  smallBtnFilled: { backgroundColor: COLORS.red },
  smallBtnFilledTxt: { color: "#000", fontWeight: "900", fontSize: 13 },
  smallBtnGhost: { borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  smallBtnGhostTxt: { color: COLORS.textDim, fontWeight: "800", fontSize: 13 },
  makeOfferLink: { color: COLORS.red, fontWeight: "800", fontSize: 13, textAlign: "center" },
  stopBadge: {
    flexDirection: "row", alignItems: "center", gap: 4,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.pill, paddingHorizontal: 8, paddingVertical: 3,
  },
  stopBadgeTxt: { color: COLORS.textDim, fontSize: 11, fontWeight: "700" },
});