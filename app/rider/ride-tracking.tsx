import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert, TextInput } from "react-native";
import MapView, { PROVIDER_GOOGLE, Marker } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import PulsingDot from "../../src/components/PulsingDot";
import SOSFab from "../../src/components/SOSFab";
import SupportChatFab from "../../src/components/SupportChatFab";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { bearing } from "../../src/lib/geo";
import { flyTo, regionFromCenterZoom } from "../../src/lib/mapCamera";
import {
  Ride, getRideById, subscribeToRide, cancelRide,
  formatFare, statusLabel, TIER_CONFIG,
  RideStop, getRideStops, subscribeToRideStops,
  minRiderOfferCents, proposeRiderFare,
} from "../../src/lib/rides";
import {
  RideOffer, OfferThread, getRideOffers, proposeOffer, respondToOffer,
  subscribeToRideOffers, groupOffersByDriver, getProfileName,
} from "../../src/lib/negotiation";

const DRIVER_MOVE_DURATION_MS = 900;

function etaMinutes(ride: Ride): number | null {
  if (!ride.accepted_at) return null;
  if (ride.status === "driver_arrived" || ride.status === "in_progress") return 0;
  const elapsed = (Date.now() - new Date(ride.accepted_at).getTime()) / 60000;
  const est = (ride.estimated_duration_min ?? 10) * 0.4;
  return Math.max(0, Math.round(est - elapsed));
}

export default function RideTrackingScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const mapRef = useRef<MapView>(null);
  const [ride, setRide] = useState<Ride | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Fare negotiation — offers from all interested drivers on this
  // 'requested' ride, grouped into one thread per driver.
  const [offers, setOffers] = useState<RideOffer[]>([]);
  const [driverNames, setDriverNames] = useState<Record<string, string>>({});
  const [counteringDriverId, setCounteringDriverId] = useState<string | null>(null);
  const [counterInput, setCounterInput] = useState("");
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [stops, setStops] = useState<RideStop[]>([]);

  // Rider-initiated broadcast fare proposal — this is the only way a
  // negotiation on a ride can start; drivers can only respond to it.
  const [riderOfferInput, setRiderOfferInput] = useState("");
  const [editingRiderOffer, setEditingRiderOffer] = useState(false);
  const [riderOfferBusy, setRiderOfferBusy] = useState(false);

  // Smoothly-animated driver marker position + heading, instead of the dot
  // jumping straight to each new GPS update.
  const [driverPos, setDriverPos] = useState<{ lat: number; lng: number } | null>(null);
  const [driverBearing, setDriverBearing] = useState(0);
  const prevDriverPos = useRef<{ lat: number; lng: number } | null>(null);
  const rafRef = useRef<number | null>(null);

  useEffect(() => {
    if (!rideId) {
      setError("No ride reference was passed to this screen.");
      return;
    }
    let cancelled = false;
    getRideById(rideId)
      .then((r) => {
        if (cancelled) return;
        if (r) setRide(r);
        else setError("Couldn't find that ride. It may have been removed.");
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Failed to load ride details.");
      });

    getRideStops(rideId)
      .then((s) => { if (!cancelled) setStops(s); })
      .catch(() => {});

    return () => { cancelled = true; };
  }, [rideId]);

  useEffect(() => {
    if (!rideId) return;
    const unsub = subscribeToRide(rideId, (updated) => {
      setRide(updated);
      if (updated.status === "completed" || updated.status === "cancelled") {
        router.replace({ pathname: "/(rider)/ride-complete", params: { rideId } });
      }
    });
    return unsub;
  }, [rideId]);

  useEffect(() => {
    if (!rideId) return;
    const unsub = subscribeToRideStops(rideId, (updated) => {
      setStops((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    });
    return unsub;
  }, [rideId]);

  // Animate the driver marker from its last known spot to the new one
  // (instead of teleporting), and rotate the car icon to face the
  // direction of travel — used both while en route to pickup and while
  // the trip is in progress.
  useEffect(() => {
    if (!ride?.driver_lat || !ride?.driver_lng) return;
    const next = { lat: ride.driver_lat, lng: ride.driver_lng };
    const prev = prevDriverPos.current;

    if (prev && (prev.lat !== next.lat || prev.lng !== next.lng)) {
      const dist = Math.hypot(next.lat - prev.lat, next.lng - prev.lng);
      // Ignore GPS jitter; only re-orient the car on a real move.
      if (dist > 0.00003) {
        setDriverBearing(bearing(prev.lat, prev.lng, next.lat, next.lng));
      }

      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      const start = Date.now();
      const tick = () => {
        const t = Math.min(1, (Date.now() - start) / DRIVER_MOVE_DURATION_MS);
        setDriverPos({
          lat: prev.lat + (next.lat - prev.lat) * t,
          lng: prev.lng + (next.lng - prev.lng) * t,
        });
        if (t < 1) rafRef.current = requestAnimationFrame(tick);
      };
      rafRef.current = requestAnimationFrame(tick);
    } else {
      setDriverPos(next);
    }

    prevDriverPos.current = next;

    flyTo(mapRef, next.lng, next.lat, 15, 600);

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ride?.driver_lat, ride?.driver_lng]);

  // Fare negotiation — only relevant while still looking for a driver.
  useEffect(() => {
    if (!rideId || ride?.status !== "requested") return;
    let cancelled = false;

    getRideOffers(rideId)
      .then(async (list) => {
        if (cancelled) return;
        setOffers(list);
        const uniqueDriverIds = Array.from(new Set(list.map((o) => o.driver_id)));
        const names = await Promise.all(uniqueDriverIds.map((id) => getProfileName(id)));
        if (cancelled) return;
        setDriverNames((prev) => ({
          ...prev,
          ...Object.fromEntries(uniqueDriverIds.map((id, i) => [id, names[i]])),
        }));
      })
      .catch(() => {});

    const unsub = subscribeToRideOffers(rideId, (o) => {
      setOffers((prev) => {
        const exists = prev.some((p) => p.id === o.id);
        return exists ? prev.map((p) => (p.id === o.id ? o : p)) : [...prev, o];
      });
      setDriverNames((prev) => {
        if (prev[o.driver_id]) return prev;
        getProfileName(o.driver_id).then((name) =>
          setDriverNames((p2) => ({ ...p2, [o.driver_id]: name }))
        );
        return prev;
      });
    });

    return () => {
      cancelled = true;
      unsub();
    };
  }, [rideId, ride?.status]);

  const handleAcceptOffer = async (offerId: string) => {
    setOfferBusy(offerId);
    try {
      await respondToOffer(offerId, true);
      // The ride subscription above will pick up status -> 'accepted'.
    } catch (e: any) {
      Alert.alert("Couldn't accept offer", e?.message ?? "That driver may no longer be available.");
    } finally {
      setOfferBusy(null);
    }
  };

  const handleDeclineOffer = async (offerId: string) => {
    setOfferBusy(offerId);
    try {
      const updated = await respondToOffer(offerId, false);
      setOffers((prev) => prev.map((o) => (o.id === updated.id ? updated : o)));
    } catch (e: any) {
      Alert.alert("Couldn't decline offer", e?.message ?? "Please try again.");
    } finally {
      setOfferBusy(null);
    }
  };

  const handleCounter = async (driverId: string) => {
    const amount = Math.round(parseFloat(counterInput) * 100);
    if (!amount || amount <= 0) {
      Alert.alert("Enter an amount", "Please enter a valid counter-offer.");
      return;
    }
    if (!rideId) return;
    setOfferBusy(driverId);
    try {
      const offer = await proposeOffer(rideId, amount, driverId);
      setOffers((prev) => [...prev, offer]);
      setCounteringDriverId(null);
      setCounterInput("");
    } catch (e: any) {
      Alert.alert("Couldn't send counter-offer", e?.message ?? "Please try again.");
    } finally {
      setOfferBusy(null);
    }
  };

  const handleProposeRiderFare = async () => {
    if (!rideId || !ride) return;
    const amount = Math.round(parseFloat(riderOfferInput) * 100);
    if (!amount || amount <= 0) {
      Alert.alert("Enter an amount", "Please enter a valid fare offer.");
      return;
    }
    const min = minRiderOfferCents(ride.estimated_fare_cents ?? 0);
    if (amount < min) {
      Alert.alert("Offer too low", `Your offer can't be less than ${formatFare(min)} (50% of the estimated fare).`);
      return;
    }
    setRiderOfferBusy(true);
    try {
      const updated = await proposeRiderFare(rideId, amount);
      setRide(updated);
      setEditingRiderOffer(false);
      setRiderOfferInput("");
    } catch (e: any) {
      Alert.alert("Couldn't send your offer", e?.message ?? "Please try again.");
    } finally {
      setRiderOfferBusy(false);
    }
  };

  const handleCancel = () => {
    Alert.alert(
      "Cancel Ride",
      ride?.status !== "requested"
        ? "A cancellation fee may apply since your driver is already on the way."
        : "Cancel your ride request?",
      [
        { text: "Keep ride", style: "cancel" },
        {
          text: "Cancel ride", style: "destructive",
          onPress: async () => {
            setCancelling(true);
            try {
              await cancelRide(rideId!);
              router.replace("/(rider)/home");
            } catch (e: any) {
              Alert.alert("Error", e?.message ?? "Failed to cancel.");
              setCancelling(false);
            }
          },
        },
      ]
    );
  };

  if (error) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Ionicons name="alert-circle" size={40} color="rgba(255,90,90,0.9)" />
          <Text style={{ color: COLORS.textDim, marginTop: SPACE.sm, textAlign: "center", paddingHorizontal: SPACE.lg }}>
            {error}
          </Text>
          <View style={{ height: SPACE.md }} />
          <PrimaryButton label="Back to Home" onPress={() => router.replace("/(rider)/home")} />
        </View>
      </Screen>
    );
  }

  if (!ride) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Text style={{ color: COLORS.textDim }}>Loading ride...</Text>
        </View>
      </Screen>
    );
  }

  const canCancel = !["in_progress", "completed", "cancelled"].includes(ride.status);
  const eta = etaMinutes(ride);
  const tierCfg = TIER_CONFIG[ride.ride_tier ?? "economy"];

  return (
    <Screen>
      <View style={styles.root}>
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={regionFromCenterZoom(ride.pickup_lng, ride.pickup_lat, 14)}
        >
          {/* Pickup — pulses while we're still searching for a driver */}
          <Marker coordinate={{ latitude: ride.pickup_lat, longitude: ride.pickup_lng }} anchor={{ x: 0.5, y: 0.5 }}>
            <View style={styles.markerPickupWrap}>
              {ride.status === "requested" && (
                <View style={styles.pulseWrap} pointerEvents="none">
                  <PulsingDot color={COLORS.red} size={12} />
                </View>
              )}
              <View style={styles.markerPickup}>
                <Ionicons name="ellipse" size={10} color="#000" />
              </View>
            </View>
          </Marker>

          {/* Stops */}
          {stops.map((stop, i) => (
            <Marker key={stop.id} coordinate={{ latitude: stop.lat, longitude: stop.lng }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={[styles.markerStop, stop.reached_at && styles.markerStopReached]}>
                <Text style={styles.markerStopTxt}>{stop.reached_at ? "✓" : i + 1}</Text>
              </View>
            </Marker>
          ))}

          {/* Destination */}
          <Marker coordinate={{ latitude: ride.destination_lat, longitude: ride.destination_lng }} anchor={{ x: 0.5, y: 1 }}>
            <View style={styles.markerDest}>
              <Ionicons name="location" size={26} color={COLORS.red} />
            </View>
          </Marker>

          {/* Driver — animates smoothly between updates and rotates to face
              its direction of travel toward pickup/destination. */}
          {driverPos && (
            <Marker
              coordinate={{ latitude: driverPos.lat, longitude: driverPos.lng }}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.driverDot, { transform: [{ rotate: `${driverBearing}deg` }] }]}>
                <Ionicons name="navigate" size={16} color="#000" />
              </View>
            </Marker>
          )}
        </MapView>

        <SOSFab rideId={ride.id} role="rider" />
        <SupportChatFab role="rider" bottom={280} />

        {/* Status panel */}
        <View style={styles.panel}>
          <GlassCard style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
                {ride.status === "requested" && (
                  <View style={styles.miniPulseWrap}>
                    <PulsingDot color={COLORS.red} size={8} />
                  </View>
                )}
                <View>
                  <Text style={styles.statusText}>{statusLabel(ride.status)}</Text>
                  {eta !== null && ride.status !== "in_progress" && (
                    <Text style={styles.etaTxt}>
                      {eta === 0 ? "Driver is here" : `~${eta} min away`}
                    </Text>
                  )}
                </View>
              </View>
              <View style={styles.tierBadge}>
                <Ionicons name={tierCfg.icon as any} size={14} color={COLORS.red} />
                <Text style={styles.tierBadgeTxt}>{tierCfg.label}</Text>
              </View>
            </View>

            {ride.estimated_fare_cents ? (
              <Text style={styles.fareText}>Est. {formatFare(ride.estimated_fare_cents)}</Text>
            ) : null}
          </GlassCard>

          {stops.length > 0 && (ride.status === "in_progress" || ride.status === "driver_arrived") && (
            <GlassCard style={{ gap: 10 }}>
              <Text style={styles.offersHeading}>Stops</Text>
              {stops.map((stop, i) => (
                <View key={stop.id} style={styles.stopRow}>
                  <View style={[styles.stopNumber, stop.reached_at && styles.stopNumberDone]}>
                    <Text style={styles.stopNumberTxt}>{stop.reached_at ? "✓" : i + 1}</Text>
                  </View>
                  <Text style={styles.stopAddress} numberOfLines={1}>{stop.address}</Text>
                </View>
              ))}
            </GlassCard>
          )}

          {ride.status === "requested" && (
            <GlassCard style={{ gap: 10 }}>
              <Text style={styles.offersHeading}>Propose Your Fare</Text>
              {ride.rider_proposed_fare_cents ? (
                <Text style={styles.negotiationTxt}>
                  You offered <Text style={{ fontWeight: "900" }}>{formatFare(ride.rider_proposed_fare_cents)}</Text>
                  {" "}— visible to nearby drivers.
                </Text>
              ) : (
                <Text style={styles.negotiationTxt}>
                  Propose a fare and any nearby driver can accept it or counter.
                  {ride.estimated_fare_cents
                    ? ` Minimum ${formatFare(minRiderOfferCents(ride.estimated_fare_cents))}.`
                    : ""}
                </Text>
              )}

              {editingRiderOffer ? (
                <View style={styles.offerInputRow}>
                  <TextInput
                    value={riderOfferInput}
                    onChangeText={setRiderOfferInput}
                    placeholder="Your price (R)"
                    placeholderTextColor={COLORS.textFaint}
                    keyboardType="decimal-pad"
                    style={styles.offerInput}
                    autoFocus
                  />
                  <Pressable
                    style={[styles.smallBtn, styles.smallBtnFilled]}
                    disabled={riderOfferBusy}
                    onPress={handleProposeRiderFare}
                  >
                    <Text style={styles.smallBtnFilledTxt}>{riderOfferBusy ? "..." : "Send"}</Text>
                  </Pressable>
                </View>
              ) : (
                <Pressable onPress={() => { setEditingRiderOffer(true); setRiderOfferInput(""); }}>
                  <Text style={styles.makeOfferLink}>
                    {ride.rider_proposed_fare_cents ? "Update your offer" : "Propose a fare"}
                  </Text>
                </Pressable>
              )}
            </GlassCard>
          )}

          {ride.status === "requested" && groupOffersByDriver(offers).length > 0 && (
            <View style={{ gap: SPACE.sm }}>
              <Text style={styles.offersHeading}>Driver Offers</Text>
              {groupOffersByDriver(offers).map((thread: OfferThread) => {
                if (thread.latest.status !== "pending") return null;
                const isCountering = counteringDriverId === thread.driverId;
                const busy = offerBusy === thread.driverId || offerBusy === thread.latest.id;
                const name = driverNames[thread.driverId] ?? "Driver";

                return (
                  <GlassCard key={thread.driverId} style={styles.offerCard}>
                    <View style={styles.offerRow}>
                      <Text style={styles.offerDriverName}>{name}</Text>
                      <Text style={styles.offerAmount}>{formatFare(thread.latest.amount_cents)}</Text>
                    </View>
                    <Text style={styles.offerSubtitle}>
                      {thread.latest.proposed_by === "driver"
                        ? "wants this fare for your trip"
                        : "waiting for your counter to be answered"}
                    </Text>

                    {thread.latest.proposed_by === "driver" ? (
                      isCountering ? (
                        <View style={styles.offerInputRow}>
                          <TextInput
                            value={counterInput}
                            onChangeText={setCounterInput}
                            placeholder="Your counter (R)"
                            placeholderTextColor={COLORS.textFaint}
                            keyboardType="decimal-pad"
                            style={styles.offerInput}
                            autoFocus
                          />
                          <Pressable
                            style={[styles.smallBtn, styles.smallBtnFilled]}
                            disabled={busy}
                            onPress={() => handleCounter(thread.driverId)}
                          >
                            <Text style={styles.smallBtnFilledTxt}>{busy ? "..." : "Send"}</Text>
                          </Pressable>
                        </View>
                      ) : (
                        <View style={styles.negotiationBtnRow}>
                          <Pressable
                            style={[styles.smallBtn, styles.smallBtnGhost]}
                            disabled={busy}
                            onPress={() => handleDeclineOffer(thread.latest.id)}
                          >
                            <Text style={styles.smallBtnGhostTxt}>Decline</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.smallBtn, styles.smallBtnGhost]}
                            disabled={busy}
                            onPress={() => { setCounteringDriverId(thread.driverId); setCounterInput(""); }}
                          >
                            <Text style={styles.smallBtnGhostTxt}>Counter</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.smallBtn, styles.smallBtnFilled]}
                            disabled={busy}
                            onPress={() => handleAcceptOffer(thread.latest.id)}
                          >
                            <Text style={styles.smallBtnFilledTxt}>{busy ? "..." : "Accept"}</Text>
                          </Pressable>
                        </View>
                      )
                    ) : null}
                  </GlassCard>
                );
              })}
            </View>
          )}

          <View style={styles.tripDetails}>
            <View style={styles.detailRow}>
              <View style={styles.dotPickup} />
              <Text style={styles.detailText} numberOfLines={1}>{ride.pickup_address}</Text>
            </View>
            <View style={[styles.detailRow, { marginTop: 8 }]}>
              <Ionicons name="location" size={16} color={COLORS.red} />
              <Text style={styles.detailText} numberOfLines={1}>{ride.destination_address}</Text>
            </View>
          </View>

          {ride.driver_id && ride.status !== "completed" && ride.status !== "cancelled" && (
            <PrimaryButton
              label="Message Driver"
              onPress={() => router.push({ pathname: "/(rider)/ride-chat", params: { rideId: ride.id } })}
              danger
            />
          )}

          {canCancel && (
            <PrimaryButton
              label={cancelling ? "Cancelling..." : "Cancel Ride"}
              onPress={handleCancel}
              disabled={cancelling}
              danger
            />
          )}
        </View>
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  panel: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    padding: SPACE.md, paddingBottom: SPACE.xl, gap: SPACE.sm,
  },
  statusCard: { gap: SPACE.xs },
  statusRow: { flexDirection: "row", alignItems: "flex-start", justifyContent: "space-between" },
  statusText: { color: COLORS.text, fontWeight: "900", fontSize: 17 },
  etaTxt: { color: COLORS.textDim, fontSize: 13, marginTop: 2 },
  fareText: { color: COLORS.textFaint, fontSize: 12 },
  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,46,46,0.1)",
    borderRadius: RADIUS.pill, paddingHorizontal: 10, paddingVertical: 4,
    borderWidth: 1, borderColor: "rgba(255,46,46,0.25)",
  },
  tierBadgeTxt: { color: COLORS.red, fontWeight: "800", fontSize: 12 },
  tripDetails: { gap: 4 },
  detailRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  detailText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  dotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.text, backgroundColor: "transparent",
  },
  markerPickupWrap: { alignItems: "center", justifyContent: "center" },
  pulseWrap: { position: "absolute" },
  miniPulseWrap: { width: 10, height: 10, alignItems: "center", justifyContent: "center", overflow: "visible" },
  markerPickup: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.text, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#000",
  },
  markerDest: { alignItems: "center" },
  markerStop: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.red, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#000",
  },
  markerStopReached: { backgroundColor: "rgba(120,220,150,0.95)" },
  markerStopTxt: { color: "#000", fontWeight: "900", fontSize: 11 },
  stopRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  stopNumber: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center",
  },
  stopNumberDone: { backgroundColor: "rgba(120,220,150,0.95)" },
  stopNumberTxt: { color: COLORS.text, fontWeight: "900", fontSize: 11 },
  stopAddress: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  driverDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.text, alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: COLORS.red,
  },
  offersHeading: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800", paddingLeft: 4,
  },
  offerCard: { gap: 8 },
  offerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  offerDriverName: { color: COLORS.text, fontWeight: "900", fontSize: 15 },
  offerAmount: { color: COLORS.red, fontWeight: "900", fontSize: 18 },
  offerSubtitle: { color: COLORS.textDim, fontSize: 12 },
  negotiationTxt: { color: COLORS.textDim, fontSize: 13, flexShrink: 1 },
  makeOfferLink: { color: COLORS.red, fontWeight: "800", fontSize: 13, textAlign: "center" },
  negotiationBtnRow: { flexDirection: "row", gap: 8 },
  offerInputRow: { flexDirection: "row", gap: 8 },
  offerInput: {
    flex: 1, color: COLORS.text, fontSize: 14,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.md, paddingHorizontal: 14, height: 44,
  },
  smallBtn: { height: 40, minWidth: 76, paddingHorizontal: 12, borderRadius: RADIUS.md, alignItems: "center", justifyContent: "center", flex: 1 },
  smallBtnFilled: { backgroundColor: COLORS.red },
  smallBtnFilledTxt: { color: "#000", fontWeight: "900", fontSize: 13 },
  smallBtnGhost: { borderWidth: 1, borderColor: "rgba(255,255,255,0.15)" },
  smallBtnGhostTxt: { color: COLORS.textDim, fontWeight: "800", fontSize: 13 },
});