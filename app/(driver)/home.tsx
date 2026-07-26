import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Vibration, Animated, Alert, TextInput,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import MapView, { PROVIDER_GOOGLE, Marker } from "react-native-maps";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import RowItem from "../../src/components/RowItem";
import SOSFab from "../../src/components/SOSFab";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { regionFromCenterZoom } from "../../src/lib/mapCamera";
import {
  Ride, getPendingRideRequests, getActiveRideForDriver,
  acceptRide, formatFare, TIER_CONFIG, getRideHistory,
} from "../../src/lib/rides";
import {
  RideOffer, getRideOffers, proposeOffer, respondToOffer,
} from "../../src/lib/negotiation";
import { getEarningsSummary, EarningsSummary, formatCents } from "../../src/lib/wallet";
import { getCurrentProfile } from "../../src/lib/auth";
import { getMyVerificationStatus, VerificationStatus } from "../../src/lib/verification";
import { haversineKm, formatDistance, progressiveRadiusKm } from "../../src/lib/geo";
import { useDriverOnline } from "../../src/lib/driverStatus";
import { updateMyLocation } from "../../src/lib/presence";

const MAX_SEARCH_RADIUS_KM = 1.6;
const POLL_INTERVAL_MS = 4000;

type NearbyRide = Ride & { distanceKm: number };

function formatElapsed(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
}

export default function DriverHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [online, setOnline] = useDriverOnline();
  const [firstName, setFirstName] = useState("");
  const [vehicle, setVehicle] = useState<{ make: string; model: string; plate: string } | null>(null);
  const [verificationStatus, setVerificationStatus] = useState<VerificationStatus>("unverified");
  const [lastTrip, setLastTrip] = useState<Ride | null>(null);
  const [earnings, setEarnings] = useState<EarningsSummary | null>(null);
  const [coords, setCoords] = useState<[number, number] | null>(null); // [lng, lat]
  const [nearby, setNearby] = useState<NearbyRide[]>([]);
  const [offersByRide, setOffersByRide] = useState<Record<string, RideOffer[]>>({});
  const [negotiatingRide, setNegotiatingRide] = useState<string | null>(null);
  const [offerInput, setOfferInput] = useState("");
  const [offerBusy, setOfferBusy] = useState<string | null>(null);
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [onlineSince, setOnlineSince] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [newRequestBanner, setNewRequestBanner] = useState<NearbyRide | null>(null);

  const mapRef = useRef<MapView>(null);
  const coordsRef = useRef<[number, number] | null>(null);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const watchRef = useRef<Location.LocationSubscription | null>(null);
  const bannerAnim = useRef(new Animated.Value(0)).current;
  const bannerTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => { coordsRef.current = coords; }, [coords]);

  // Redirect straight to an active trip (e.g. app was relaunched mid-ride),
  // and refresh profile/earnings every time this screen gains focus.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    getActiveRideForDriver()
      .then((active) => {
        if (active && !cancelled) {
          router.replace({ pathname: "/(driver)/active-trip", params: { rideId: active.id } });
        }
      })
      .catch(() => {});
    getCurrentProfile()
      .then((p) => {
        if (!p || cancelled) return;
        setFirstName(p.first_name);
        if (p.vehicle_make || p.vehicle_model || p.license_plate) {
          setVehicle({
            make: p.vehicle_make ?? "",
            model: p.vehicle_model ?? "",
            plate: p.license_plate ?? "",
          });
        }
      })
      .catch(() => {});
    getMyVerificationStatus()
      .then((v) => { if (!cancelled) setVerificationStatus(v.status); })
      .catch(() => {});
    getEarningsSummary().then((s) => { if (!cancelled) setEarnings(s); }).catch(() => {});
    getRideHistory(1).then((h) => { if (!cancelled) setLastTrip(h[0] ?? null); }).catch(() => {});
    return () => { cancelled = true; };
  }, []));

  // Get an initial GPS fix so the map has somewhere sensible to center,
  // regardless of online status.
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") { setLocationDenied(true); return; }
        setLocationDenied(false);
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        setCoords([pos.coords.longitude, pos.coords.latitude]);
      } catch {
        setLocationDenied(true);
      }
    })();
  }, []);

  // Lightweight presence ping — independent of the Go Online toggle, so
  // even a driver who's just browsing (not online) stays locatable for
  // nearby public SOS alerts. The online-specific refresh (for nearby ride
  // request push) lives in src/lib/driverStatus.ts.
  useEffect(() => {
    const ping = async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
        updateMyLocation(pos.coords.latitude, pos.coords.longitude).catch(() => {});
      } catch {
        // non-critical
      }
    };
    ping();
    const interval = setInterval(ping, 60_000);
    return () => clearInterval(interval);
  }, []);

  const triggerNewRequestAlert = useCallback((ride: NearbyRide) => {
    Vibration.vibrate(300);
    setNewRequestBanner(ride);
    bannerAnim.setValue(0);
    Animated.timing(bannerAnim, { toValue: 1, duration: 250, useNativeDriver: true }).start();
    if (bannerTimeoutRef.current) clearTimeout(bannerTimeoutRef.current);
    bannerTimeoutRef.current = setTimeout(() => {
      Animated.timing(bannerAnim, { toValue: 0, duration: 220, useNativeDriver: true }).start(() => {
        setNewRequestBanner(null);
      });
    }, 5000);
  }, [bannerAnim]);

  const pollNearby = useCallback(async () => {
    try {
      const pending = await getPendingRideRequests();
      const origin = coordsRef.current;

      const withDist: NearbyRide[] = origin
        ? pending
            .map((r) => ({
              ...r,
              distanceKm: haversineKm(origin[1], origin[0], r.pickup_lat, r.pickup_lng),
            }))
            .filter((r) => r.distanceKm <= progressiveRadiusKm(r.requested_at))
            .sort((a, b) => a.distanceKm - b.distanceKm)
        : pending.map((r) => ({ ...r, distanceKm: NaN }));

      // Notify only for genuinely new requests, and never on the very first
      // poll after going online (that would spam for pre-existing requests).
      const isFirstPoll = seenIdsRef.current.size === 0;
      const freshOnes = withDist.filter((r) => !seenIdsRef.current.has(r.id));
      if (!isFirstPoll && freshOnes.length > 0) {
        triggerNewRequestAlert(freshOnes[0]);
      }
      withDist.forEach((r) => seenIdsRef.current.add(r.id));

      setNearby(withDist);
      setError(null);

      const entries = await Promise.all(
        withDist.map(async (r) => [r.id, await getRideOffers(r.id).catch(() => [])] as const)
      );
      setOffersByRide(Object.fromEntries(entries));
    } catch (e: any) {
      setError(e?.message ?? "Failed to load nearby requests.");
    }
  }, [triggerNewRequestAlert]);

  // While online: watch GPS position and poll for nearby requests.
  useEffect(() => {
    if (!online) {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (watchRef.current) { watchRef.current.remove(); watchRef.current = null; }
      setNearby([]);
      seenIdsRef.current.clear();
      setOnlineSince(null);
      return;
    }

    setOnlineSince(new Date());
    let cancelled = false;

    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status !== "granted") { setLocationDenied(true); return; }
        setLocationDenied(false);
        watchRef.current = await Location.watchPositionAsync(
          { accuracy: Location.Accuracy.High, distanceInterval: 25, timeInterval: 4000 },
          (pos) => {
            if (!cancelled) setCoords([pos.coords.longitude, pos.coords.latitude]);
          }
        );
      } catch {
        setLocationDenied(true);
      }
    })();

    pollNearby();
    pollRef.current = setInterval(pollNearby, POLL_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
      if (watchRef.current) { watchRef.current.remove(); watchRef.current = null; }
    };
  }, [online, pollNearby]);

  // Online session duration ticker
  useEffect(() => {
    if (!onlineSince) { setElapsed(0); return; }
    const id = setInterval(() => {
      setElapsed(Math.floor((Date.now() - onlineSince.getTime()) / 1000));
    }, 1000);
    return () => clearInterval(id);
  }, [onlineSince]);

  const handleAccept = async (rideId: string) => {
    setAccepting(rideId);
    try {
      await acceptRide(rideId);
      router.replace({ pathname: "/(driver)/active-trip", params: { rideId } });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to accept ride. It may have been taken by another driver.");
      setAccepting(null);
      pollNearby();
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

  const handleRespondToOffer = async (rideId: string, offerId: string, approve: boolean) => {
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

  const handleToggleOnline = () => {
    if (!online && verificationStatus !== "verified") {
      Alert.alert(
        verificationStatus === "pending" ? "Verification in review" : "Verification required",
        verificationStatus === "pending"
          ? "Your documents are still being reviewed. We'll let you know once you're approved to go online."
          : verificationStatus === "rejected"
          ? "One of your documents needs attention before you can go online."
          : "Upload your license, vehicle registration and profile photo before going online.",
        [
          { text: "Not now", style: "cancel" },
          { text: "View verification", onPress: () => router.push("/(driver)/verification") },
        ]
      );
      return;
    }
    setOnline(!online);
  };

  return (
    <Screen>
      <RiderHeader
        subtitle={online ? `Online · ${formatElapsed(elapsed)}` : "You're Offline"}
        menuOpen={menuOpen}
        onMenu={() => setMenuOpen((v) => !v)}
      />
      <SOSFab role="driver" />

      <View style={styles.mapWrap}>
        {coords ? (
          <MapView
            ref={mapRef}
            provider={PROVIDER_GOOGLE}
            style={StyleSheet.absoluteFill}
            initialRegion={regionFromCenterZoom(coords[0], coords[1], 13)}
          >
            <Marker coordinate={{ latitude: coords[1], longitude: coords[0] }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.driverDot}>
                <View style={styles.driverDotCore} />
              </View>
            </Marker>

            {online && nearby.map((r) => (
              <Marker
                key={r.id}
                coordinate={{ latitude: r.pickup_lat, longitude: r.pickup_lng }}
                anchor={{ x: 0.5, y: 1 }}
              >
                <View style={styles.reqPin}>
                  <Text style={styles.reqPinTxt} numberOfLines={1}>
                    {r.estimated_fare_cents ? formatFare(r.estimated_fare_cents) : "—"}
                  </Text>
                </View>
              </Marker>
            ))}
          </MapView>
        ) : (
          <View style={styles.mapFallback}>
            <ActivityIndicator color={COLORS.red} />
            <Text style={styles.mapFallbackTxt}>
              {locationDenied ? "Location permission needed to find nearby requests." : "Getting your location..."}
            </Text>
          </View>
        )}

        <View style={styles.statusPill}>
          <View style={[styles.statusDot, online && styles.statusDotOnline]} />
          <Text style={styles.statusPillTxt}>{online ? "Online" : "Offline"}</Text>
        </View>

        {newRequestBanner && (
          <Animated.View
            style={[
              styles.banner,
              {
                opacity: bannerAnim,
                transform: [{ translateY: bannerAnim.interpolate({ inputRange: [0, 1], outputRange: [-16, 0] }) }],
              },
            ]}
          >
            <Pressable style={styles.bannerRow} onPress={() => setNewRequestBanner(null)}>
              <Ionicons name="notifications" size={18} color={COLORS.red} />
              <View style={{ flex: 1 }}>
                <Text style={styles.bannerTitle}>New ride request nearby</Text>
                <Text style={styles.bannerSub}>
                  {formatDistance(newRequestBanner.distanceKm)} away
                  {newRequestBanner.estimated_fare_cents ? ` · ${formatFare(newRequestBanner.estimated_fare_cents)}` : ""}
                </Text>
              </View>
            </Pressable>
          </Animated.View>
        )}
      </View>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={styles.sheet}
        showsVerticalScrollIndicator={false}
      >
        <Text style={styles.greeting}>
          {online ? "You're online" : `Hi${firstName ? `, ${firstName}` : ""}`}
        </Text>

        <View style={styles.statsGrid}>
          <View style={styles.statsRow}>
            <GlassCard style={styles.statCard}>
              <Text style={styles.statLabel}>Today</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {earnings ? formatCents(earnings.todayCents) : "—"}
              </Text>
              <Text style={styles.statSub}>
                {earnings ? `${earnings.tripsToday} trip${earnings.tripsToday === 1 ? "" : "s"}` : ""}
              </Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Text style={styles.statLabel}>This week</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {earnings ? formatCents(earnings.weekCents) : "—"}
              </Text>
              <Text style={styles.statSub}>
                {earnings ? `${earnings.tripsWeek} trip${earnings.tripsWeek === 1 ? "" : "s"}` : ""}
              </Text>
            </GlassCard>
          </View>
          <View style={styles.statsRow}>
            <GlassCard style={styles.statCard}>
              <Text style={styles.statLabel}>Lifetime earned</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {earnings ? formatCents(earnings.lifetimeCents) : "—"}
              </Text>
              <Text style={styles.statSub}>all time</Text>
            </GlassCard>
            <GlassCard style={styles.statCard}>
              <Text style={styles.statLabel}>Trips</Text>
              <Text style={styles.statValue} numberOfLines={1}>
                {earnings ? earnings.tripsLifetime : "—"}
              </Text>
              <Text style={styles.statSub}>completed</Text>
            </GlassCard>
          </View>
        </View>

        {vehicle && (
          <Pressable onPress={() => router.push("/(driver)/profile")}>
            <GlassCard style={styles.vehicleCard}>
              <View style={styles.vehicleIconWrap}>
                <Ionicons name="car-sport" size={20} color={COLORS.red} />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.vehicleTitle} numberOfLines={1}>
                  {[vehicle.make, vehicle.model].filter(Boolean).join(" ") || "Your vehicle"}
                </Text>
                <Text style={styles.vehicleSub}>
                  {vehicle.plate ? `Plate ${vehicle.plate}` : "Tap to add vehicle details"}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={COLORS.textFaint} />
            </GlassCard>
          </Pressable>
        )}

        {error ? <Text style={styles.error}>{error}</Text> : null}

        {online ? (
          <>
            <View style={styles.sectionHeadRow}>
              <Text style={styles.sectionTitle}>Nearby requests</Text>
              <View style={styles.countBadge}>
                <Text style={styles.countBadgeTxt}>{nearby.length}</Text>
              </View>
            </View>

            {locationDenied ? (
              <GlassCard>
                <Text style={styles.emptySub}>Enable location access in your device settings to see ride requests near you.</Text>
              </GlassCard>
            ) : nearby.length === 0 ? (
              <GlassCard style={{ alignItems: "center", paddingVertical: SPACE.lg }}>
                <Ionicons name="search" size={32} color={COLORS.textFaint} />
                <Text style={styles.emptyTitle}>Searching for riders...</Text>
                <Text style={styles.emptySub}>
                  New requests within {MAX_SEARCH_RADIUS_KM} km will show up here automatically — closer riders are matched first.
                </Text>
              </GlassCard>
            ) : (
              nearby.map((r) => {
                const tierCfg = TIER_CONFIG[r.ride_tier ?? "economy"];
                const thread = offersByRide[r.id] ?? [];
                const latest = thread.length ? thread[thread.length - 1] : null;
                const pendingOffer = latest?.status === "pending" ? latest : null;
                const isNegotiating = negotiatingRide === r.id;
                const busy = offerBusy === r.id;

                return (
                  <GlassCard key={r.id} style={styles.reqCard}>
                    <View style={styles.reqTop}>
                      <Text style={styles.reqFare}>
                        {r.estimated_fare_cents ? formatFare(r.estimated_fare_cents) : "—"}
                      </Text>
                      <View style={styles.reqDistBadge}>
                        <Ionicons name="navigate" size={12} color={COLORS.red} />
                        <Text style={styles.reqDistTxt}>{formatDistance(r.distanceKm)} away</Text>
                      </View>
                    </View>

                    <View style={styles.locationBlock}>
                      <View style={styles.locationRow}>
                        <View style={styles.dotPickup} />
                        <Text style={styles.locationText} numberOfLines={1}>{r.pickup_address}</Text>
                      </View>
                      <View style={[styles.locationRow, { marginTop: 6 }]}>
                        <Ionicons name="location" size={14} color={COLORS.red} />
                        <Text style={styles.locationText} numberOfLines={1}>{r.destination_address}</Text>
                      </View>
                    </View>

                    <View style={styles.reqFootRow}>
                      <View style={styles.tierBadge}>
                        <Ionicons name={tierCfg.icon as any} size={12} color={COLORS.red} />
                        <Text style={styles.tierBadgeTxt}>{tierCfg.label}</Text>
                      </View>
                      {r.estimated_distance_km && r.estimated_duration_min ? (
                        <Text style={styles.tripMeta}>
                          {r.estimated_distance_km.toFixed(1)} km trip · {Math.round(r.estimated_duration_min)} min
                        </Text>
                      ) : null}
                    </View>

                    {pendingOffer?.proposed_by === "rider" ? (
                      <View style={styles.negotiationBox}>
                        <Text style={styles.negotiationTxt}>
                          Rider countered with <Text style={{ fontWeight: "900" }}>{formatFare(pendingOffer.amount_cents)}</Text>
                        </Text>
                        <View style={styles.negotiationBtnRow}>
                          <Pressable
                            style={[styles.smallBtn, styles.smallBtnGhost]}
                            disabled={busy}
                            onPress={() => handleRespondToOffer(r.id, pendingOffer.id, false)}
                          >
                            <Text style={styles.smallBtnGhostTxt}>Decline</Text>
                          </Pressable>
                          <Pressable
                            style={[styles.smallBtn, styles.smallBtnFilled]}
                            disabled={busy}
                            onPress={() => handleRespondToOffer(r.id, pendingOffer.id, true)}
                          >
                            <Text style={styles.smallBtnFilledTxt}>
                              {busy ? "..." : `Accept ${formatFare(pendingOffer.amount_cents)}`}
                            </Text>
                          </Pressable>
                        </View>
                      </View>
                    ) : pendingOffer?.proposed_by === "driver" ? (
                      <View style={styles.negotiationBox}>
                        <Ionicons name="time-outline" size={14} color={COLORS.textDim} />
                        <Text style={styles.negotiationTxt}>
                          Your offer of {formatFare(pendingOffer.amount_cents)} is awaiting the rider
                        </Text>
                      </View>
                    ) : null}

                    {!pendingOffer && r.rider_proposed_fare_cents ? (
                      // Rider has broadcast a proposed fare on this ride —
                      // that's the only way a negotiation can start.
                      <View style={styles.negotiationBox}>
                        <Text style={styles.negotiationTxt}>
                          Rider proposed <Text style={{ fontWeight: "900" }}>{formatFare(r.rider_proposed_fare_cents)}</Text>
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
                          onPress={() => handleSendOffer(r.id)}
                        >
                          <Text style={styles.smallBtnFilledTxt}>{busy ? "..." : "Send"}</Text>
                        </Pressable>
                      </View>
                    ) : null}

                    <PrimaryButton
                      label={accepting === r.id ? "Accepting..." : "Accept Ride"}
                      onPress={() => handleAccept(r.id)}
                      disabled={!!accepting}
                    />

                    {/* Only shown once the rider has opened negotiation on
                        this ride — a driver can never start one from scratch. */}
                    {!pendingOffer && !isNegotiating && r.rider_proposed_fare_cents ? (
                      <Pressable
                        onPress={() => {
                          setNegotiatingRide(r.id);
                          setOfferInput(String((r.rider_proposed_fare_cents! / 100).toFixed(2)));
                        }}
                      >
                        <Text style={styles.makeOfferLink}>
                          Accept {formatFare(r.rider_proposed_fare_cents)} or send a counter
                        </Text>
                      </Pressable>
                    ) : null}
                  </GlassCard>
                );
              })
            )}
          </>
        ) : (
          <GlassCard style={{ gap: 6 }}>
            <Text style={styles.emptyTitle}>You're offline</Text>
            <Text style={styles.emptySub}>Go online to start seeing nearby ride requests and earning.</Text>
          </GlassCard>
        )}

        {lastTrip && (
          <>
            <Text style={styles.sectionTitle}>Last trip</Text>
            <Pressable onPress={() => router.push("/(driver)/trip-history")}>
              <GlassCard style={styles.lastTripCard}>
                <View style={styles.lastTripTop}>
                  <Text style={styles.lastTripFare}>
                    {lastTrip.status === "cancelled"
                      ? (lastTrip.cancellation_fee_cents ? formatFare(lastTrip.cancellation_fee_cents) : "Cancelled")
                      : (lastTrip.final_fare_cents ? formatFare(lastTrip.final_fare_cents) : "—")}
                  </Text>
                  <Text style={styles.lastTripDate}>
                    {new Date(lastTrip.requested_at).toLocaleDateString("en-ZA", { day: "numeric", month: "short" })}
                  </Text>
                </View>
                <Text style={styles.locationText} numberOfLines={1}>
                  {lastTrip.pickup_address} → {lastTrip.destination_address}
                </Text>
              </GlassCard>
            </Pressable>
          </>
        )}

        <Text style={styles.sectionTitle}>Quick access</Text>
        <RowItem icon="wallet-outline" title="Earnings" subtitle="Balance & payout history" onPress={() => router.push("/(driver)/wallet")} />
        <RowItem icon="time-outline" title="Trip History" subtitle="Past rides & receipts" onPress={() => router.push("/(driver)/trip-history")} />
        <RowItem icon="pricetag-outline" title="Promotions" subtitle="Driver bonuses" onPress={() => router.push("/(driver)/promotions")} />
        <RowItem icon="person-outline" title="Profile" subtitle="Personal & vehicle details" onPress={() => router.push("/(driver)/profile")} />
        <RowItem icon="settings-outline" title="Settings" subtitle="Preferences & account" onPress={() => router.push("/(driver)/settings")} />
        <RowItem icon="help-buoy-outline" title="Help & Support" subtitle="Get assistance" onPress={() => router.push("/(driver)/support")} />
      </ScrollView>

      <View style={styles.bottomBar}>
        <Pressable
          style={({ pressed }) => [styles.goBtn, online && styles.goBtnOnline, pressed && { opacity: 0.92 }]}
          onPress={handleToggleOnline}
        >
          <Ionicons name={online ? "power" : "flash"} size={18} color={online ? COLORS.red : "#000"} />
          <Text style={[styles.goBtnTxt, online && styles.goBtnTxtOnline]}>
            {online ? "GO OFFLINE" : "GO ONLINE"}
          </Text>
        </Pressable>
      </View>

      <SideMenuDrawer
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        role="driver"
        online={online}
        onToggleOnline={handleToggleOnline}
      />
    </Screen>
  );
}

const styles = StyleSheet.create({
  mapWrap: { height: 260, marginHorizontal: SPACE.md, borderRadius: RADIUS.xl, overflow: "hidden" },
  mapFallback: {
    flex: 1, alignItems: "center", justifyContent: "center", gap: SPACE.sm,
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  mapFallbackTxt: { color: COLORS.textDim, fontSize: 12, textAlign: "center", paddingHorizontal: SPACE.lg },
  driverDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: "rgba(255,46,46,0.25)", alignItems: "center", justifyContent: "center",
  },
  driverDotCore: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: COLORS.red, borderWidth: 2, borderColor: "#fff",
  },
  reqPin: {
    paddingHorizontal: 8, paddingVertical: 4, borderRadius: RADIUS.pill,
    backgroundColor: "#fff", borderWidth: 2, borderColor: COLORS.red,
  },
  reqPinTxt: { color: "#000", fontWeight: "900", fontSize: 11 },
  statusPill: {
    position: "absolute", top: 12, left: 12,
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(0,0,0,0.7)", borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 6,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.15)",
  },
  statusDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: "rgba(255,255,255,0.4)" },
  statusDotOnline: { backgroundColor: "rgba(120,220,150,0.95)" },
  statusPillTxt: { color: COLORS.text, fontSize: 11, fontWeight: "900" },
  banner: {
    position: "absolute", top: 12, left: 12, right: 12,
    backgroundColor: "rgba(10,10,10,0.95)", borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "rgba(255,46,46,0.35)",
    padding: SPACE.sm,
  },
  bannerRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  bannerTitle: { color: COLORS.text, fontWeight: "900", fontSize: 13 },
  bannerSub: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  sheet: { paddingHorizontal: SPACE.md, paddingTop: SPACE.md, paddingBottom: 140, gap: SPACE.sm },
  greeting: { color: COLORS.text, fontWeight: "900", fontSize: 20 },
  statsGrid: { gap: SPACE.sm },
  statsRow: { flexDirection: "row", gap: SPACE.sm },
  statCard: { flex: 1, alignItems: "center", paddingVertical: SPACE.sm, gap: 2 },
  statLabel: { color: COLORS.textFaint, fontSize: 10, fontWeight: "800", textTransform: "uppercase", letterSpacing: 0.5 },
  statValue: { color: COLORS.text, fontWeight: "900", fontSize: 16 },
  statSub: { color: COLORS.textFaint, fontSize: 10 },
  vehicleCard: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  vehicleIconWrap: {
    width: 38, height: 38, borderRadius: 19, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,46,46,0.12)", borderWidth: 1, borderColor: "rgba(255,46,46,0.25)",
  },
  vehicleTitle: { color: COLORS.text, fontWeight: "800", fontSize: 14 },
  vehicleSub: { color: COLORS.textFaint, fontSize: 12, marginTop: 2 },
  lastTripCard: { gap: 6 },
  lastTripTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  lastTripFare: { color: COLORS.text, fontWeight: "900", fontSize: 16 },
  lastTripDate: { color: COLORS.textFaint, fontSize: 11, fontWeight: "700" },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", textAlign: "center" },
  sectionHeadRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm, marginTop: SPACE.sm },
  sectionTitle: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800", marginTop: SPACE.sm,
  },
  countBadge: {
    backgroundColor: "rgba(255,46,46,0.15)", borderRadius: RADIUS.pill,
    paddingHorizontal: 8, paddingVertical: 2, borderWidth: 1, borderColor: "rgba(255,46,46,0.3)",
  },
  countBadgeTxt: { color: COLORS.red, fontWeight: "900", fontSize: 11 },
  emptyTitle: { color: COLORS.text, fontWeight: "900", fontSize: 15, marginTop: 6 },
  emptySub: { color: COLORS.textDim, fontSize: 12, textAlign: "center", marginTop: 4, lineHeight: 17 },
  reqCard: { gap: SPACE.sm },
  reqTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  reqFare: { color: COLORS.text, fontWeight: "900", fontSize: 22 },
  reqDistBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,46,46,0.1)", borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(255,46,46,0.25)",
  },
  reqDistTxt: { color: COLORS.red, fontWeight: "800", fontSize: 11 },
  locationBlock: { gap: 4 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  locationText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  dotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.text, backgroundColor: "transparent",
  },
  reqFootRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  tierBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,255,255,0.06)", borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  tierBadgeTxt: { color: COLORS.text, fontWeight: "800", fontSize: 11 },
  tripMeta: { color: COLORS.textFaint, fontSize: 11 },
  bottomBar: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    paddingHorizontal: SPACE.md, paddingBottom: SPACE.xl, paddingTop: SPACE.md,
    backgroundColor: "rgba(0,0,0,0.0)",
  },
  goBtn: {
    height: 56, borderRadius: RADIUS.xl, backgroundColor: COLORS.red,
    alignItems: "center", justifyContent: "center", flexDirection: "row", gap: 8,
    shadowColor: "#000", shadowOpacity: 0.5, shadowRadius: 20, shadowOffset: { width: 0, height: 10 }, elevation: 10,
  },
  goBtnOnline: {
    backgroundColor: "rgba(10,10,10,0.95)", borderWidth: 1.5, borderColor: "rgba(255,46,46,0.5)",
  },
  goBtnTxt: { color: "#000", fontWeight: "900", fontSize: 15, letterSpacing: 0.5 },
  goBtnTxtOnline: { color: COLORS.red },
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
});