import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, Vibration, Animated, Alert,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { router, useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import RowItem from "../../src/components/RowItem";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, getPendingRideRequests, getActiveRideForDriver,
  acceptRide, formatFare, TIER_CONFIG, getRideHistory,
} from "../../src/lib/rides";
import { getEarningsSummary, EarningsSummary, formatCents } from "../../src/lib/wallet";
import { getCurrentProfile } from "../../src/lib/auth";
import { getMyVerificationStatus, VerificationStatus } from "../../src/lib/verification";
import { haversineKm, formatDistance, progressiveRadiusKm } from "../../src/lib/geo";
import { useDriverOnline } from "../../src/lib/driverStatus";

const STYLE_URL = "mapbox://styles/thandoluphoko9/cmqn0smkv00b001se3b9gf6g7";
const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;
if (MAPBOX_TOKEN) Mapbox.setAccessToken(MAPBOX_TOKEN);

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
  const [accepting, setAccepting] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [locationDenied, setLocationDenied] = useState(false);
  const [onlineSince, setOnlineSince] = useState<Date | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [newRequestBanner, setNewRequestBanner] = useState<NearbyRide | null>(null);

  const cameraRef = useRef<Mapbox.Camera>(null);
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

      <View style={styles.mapWrap}>
        {coords ? (
          <Mapbox.MapView style={StyleSheet.absoluteFill} styleURL={STYLE_URL}>
            <Mapbox.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: coords, zoomLevel: 13 }} />

            <Mapbox.PointAnnotation id="driver-me" coordinate={coords}>
              <View style={styles.driverDot}>
                <View style={styles.driverDotCore} />
              </View>
            </Mapbox.PointAnnotation>

            {online && nearby.map((r) => (
              <Mapbox.PointAnnotation key={r.id} id={`req-${r.id}`} coordinate={[r.pickup_lng, r.pickup_lat]}>
                <View style={styles.reqPin}>
                  <Text style={styles.reqPinTxt} numberOfLines={1}>
                    {r.estimated_fare_cents ? formatFare(r.estimated_fare_cents) : "—"}
                  </Text>
                </View>
              </Mapbox.PointAnnotation>
            ))}
          </Mapbox.MapView>
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

                    <PrimaryButton
                      label={accepting === r.id ? "Accepting..." : "Accept Ride"}
                      onPress={() => handleAccept(r.id)}
                      disabled={!!accepting}
                    />
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
});