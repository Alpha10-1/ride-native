import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import PulsingDot from "../../src/components/PulsingDot";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { bearing } from "../../src/lib/geo";
import {
  Ride, getRideById, subscribeToRide, cancelRide,
  formatFare, statusLabel, TIER_CONFIG,
} from "../../src/lib/rides";

const DRIVER_MOVE_DURATION_MS = 900;

const STYLE_URL = "mapbox://styles/thandoluphoko9/cmqn0smkv00b001se3b9gf6g7";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;
if (MAPBOX_TOKEN) Mapbox.setAccessToken(MAPBOX_TOKEN);

function etaMinutes(ride: Ride): number | null {
  if (!ride.accepted_at) return null;
  if (ride.status === "driver_arrived" || ride.status === "in_progress") return 0;
  const elapsed = (Date.now() - new Date(ride.accepted_at).getTime()) / 60000;
  const est = (ride.estimated_duration_min ?? 10) * 0.4;
  return Math.max(0, Math.round(est - elapsed));
}

export default function RideTrackingScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [ride, setRide] = useState<Ride | null>(null);
  const [cancelling, setCancelling] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

    cameraRef.current?.setCamera?.({
      centerCoordinate: [next.lng, next.lat],
      zoomLevel: 15,
      animationMode: "flyTo",
      animationDuration: 600,
    });

    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [ride?.driver_lat, ride?.driver_lng]);

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
        <Mapbox.MapView style={StyleSheet.absoluteFill} styleURL={STYLE_URL}>
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: [ride.pickup_lng, ride.pickup_lat], zoomLevel: 14 }}
          />

          {/* Pickup — pulses while we're still searching for a driver */}
          <Mapbox.PointAnnotation id="pickup" coordinate={[ride.pickup_lng, ride.pickup_lat]}>
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
          </Mapbox.PointAnnotation>

          {/* Destination */}
          <Mapbox.PointAnnotation id="dest" coordinate={[ride.destination_lng, ride.destination_lat]}>
            <View style={styles.markerDest}>
              <Ionicons name="location" size={26} color={COLORS.red} />
            </View>
          </Mapbox.PointAnnotation>

          {/* Driver — animates smoothly between updates and rotates to face
              its direction of travel toward pickup/destination. */}
          {driverPos && (
            <Mapbox.PointAnnotation
              id="driver"
              coordinate={[driverPos.lng, driverPos.lat]}
              anchor={{ x: 0.5, y: 0.5 }}
            >
              <View style={[styles.driverDot, { transform: [{ rotate: `${driverBearing}deg` }] }]}>
                <Ionicons name="navigate" size={16} color="#000" />
              </View>
            </Mapbox.PointAnnotation>
          )}
        </Mapbox.MapView>

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
  driverDot: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: COLORS.text, alignItems: "center", justifyContent: "center",
    borderWidth: 2.5, borderColor: COLORS.red,
  },
});