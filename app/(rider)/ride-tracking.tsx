import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, getRideById, subscribeToRide, cancelRide,
  formatFare, statusLabel, TIER_CONFIG,
} from "../../src/lib/rides";

const STYLE_URL = "mapbox://styles/thandoluphoko9/cmauq6ss2001p01r20y0g444v";

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

  useEffect(() => {
    if (!rideId) return;
    getRideById(rideId).then((r) => { if (r) setRide(r); });
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

  // Fly to driver location when it updates
  useEffect(() => {
    if (ride?.driver_lat && ride?.driver_lng) {
      cameraRef.current?.setCamera?.({
        centerCoordinate: [ride.driver_lng, ride.driver_lat],
        zoomLevel: 15,
        animationMode: "flyTo",
        animationDuration: 600,
      });
    }
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

          {/* Pickup */}
          <Mapbox.PointAnnotation id="pickup" coordinate={[ride.pickup_lng, ride.pickup_lat]}>
            <View style={styles.markerPickup}>
              <Ionicons name="ellipse" size={10} color="#000" />
            </View>
          </Mapbox.PointAnnotation>

          {/* Destination */}
          <Mapbox.PointAnnotation id="dest" coordinate={[ride.destination_lng, ride.destination_lat]}>
            <View style={styles.markerDest}>
              <Ionicons name="location" size={26} color={COLORS.red} />
            </View>
          </Mapbox.PointAnnotation>

          {/* Driver dot */}
          {ride.driver_lat && ride.driver_lng && (
            <Mapbox.PointAnnotation id="driver" coordinate={[ride.driver_lng, ride.driver_lat]}>
              <View style={styles.driverDot}>
                <Ionicons name="car" size={14} color="#000" />
              </View>
            </Mapbox.PointAnnotation>
          )}
        </Mapbox.MapView>

        {/* Status panel */}
        <View style={styles.panel}>
          <GlassCard style={styles.statusCard}>
            <View style={styles.statusRow}>
              <View>
                <Text style={styles.statusText}>{statusLabel(ride.status)}</Text>
                {eta !== null && ride.status !== "in_progress" && (
                  <Text style={styles.etaTxt}>
                    {eta === 0 ? "Driver is here" : `~${eta} min away`}
                  </Text>
                )}
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