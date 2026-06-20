import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, getRideById, subscribeToRide,
  advanceRideStatus, completeRide, cancelRide,
  updateDriverLocation, formatFare, statusLabel,
} from "../../src/lib/rides";

const STYLE_URL = "mapbox://styles/thandoluphoko9/cmauq6ss2001p01r20y0g444v";

// Simulates the driver moving from pickup toward destination in small steps.
// Returns an array of [lng, lat] waypoints interpolated between two points.
function interpolateWaypoints(
  from: [number, number],
  to: [number, number],
  steps: number
): [number, number][] {
  const waypoints: [number, number][] = [];
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    waypoints.push([
      from[0] + (to[0] - from[0]) * t,
      from[1] + (to[1] - from[1]) * t,
    ]);
  }
  return waypoints;
}

export default function ActiveTripScreen() {
  const { rideId } = useLocalSearchParams<{ rideId: string }>();
  const cameraRef = useRef<Mapbox.Camera>(null);
  const simulationRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const [ride, setRide] = useState<Ride | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [tripStartTime, setTripStartTime] = useState<Date | null>(null);

  useEffect(() => {
    if (!rideId) return;
    getRideById(rideId).then((r) => {
      if (r) {
        setRide(r);
        if (r.trip_started_at) setTripStartTime(new Date(r.trip_started_at));
        // Center map on pickup initially
        cameraRef.current?.setCamera?.({
          centerCoordinate: [r.pickup_lng, r.pickup_lat],
          zoomLevel: 14,
          animationDuration: 0,
        });
      }
    });

    const unsub = subscribeToRide(rideId, (updated) => {
      setRide(updated);
    });
    return () => {
      unsub();
      if (simulationRef.current) clearInterval(simulationRef.current);
    };
  }, [rideId]);

  const handleAdvance = async () => {
    if (!ride) return;
    setActionLoading(true);
    try {
      const updated = await advanceRideStatus(ride.id);
      setRide(updated);

      // When trip starts, record start time for duration calculation
      if (updated.status === "in_progress") {
        setTripStartTime(new Date());
      }
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to update status.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleSimulateMovement = () => {
    if (!ride || simulating) return;
    setSimulating(true);

    const from: [number, number] = [ride.pickup_lng, ride.pickup_lat];
    const to: [number, number] = [ride.destination_lng, ride.destination_lat];
    const waypoints = interpolateWaypoints(from, to, 20);
    let step = 0;

    simulationRef.current = setInterval(async () => {
      if (step >= waypoints.length) {
        clearInterval(simulationRef.current!);
        setSimulating(false);
        return;
      }

      const [lng, lat] = waypoints[step];
      try {
        await updateDriverLocation(ride.id, lat, lng);
        cameraRef.current?.setCamera?.({
          centerCoordinate: [lng, lat],
          zoomLevel: 15,
          animationMode: "flyTo",
          animationDuration: 500,
        });
      } catch {
        // silent — location update failure shouldn't stop simulation
      }
      step++;
    }, 1500);
  };

  const handleCompleteRide = async () => {
    if (!ride) return;
    setActionLoading(true);
    try {
      // Use actual distance/duration from the ride record,
      // or fall back to estimates if actuals aren't stored yet.
      const durationMin = tripStartTime
        ? (Date.now() - tripStartTime.getTime()) / 60000
        : ride.estimated_duration_min ?? 10;

      await completeRide(
        ride.id,
        ride.estimated_distance_km ?? 5,
        durationMin
      );
      router.replace({ pathname: "/(driver)/trip-complete", params: { rideId: ride.id } });
    } catch (e: any) {
      Alert.alert("Error", e?.message ?? "Failed to complete ride.");
    } finally {
      setActionLoading(false);
    }
  };

  const handleCancel = () => {
    Alert.alert("Cancel Trip", "Are you sure you want to cancel this trip?", [
      { text: "Keep trip", style: "cancel" },
      {
        text: "Cancel",
        style: "destructive",
        onPress: async () => {
          setActionLoading(true);
          try {
            await cancelRide(ride!.id);
            router.replace("/(driver)/home");
          } catch (e: any) {
            Alert.alert("Error", e?.message ?? "Failed to cancel.");
            setActionLoading(false);
          }
        },
      },
    ]);
  };

  if (!ride) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Text style={{ color: COLORS.textDim }}>Loading trip...</Text>
        </View>
      </Screen>
    );
  }

  const nextActionLabel = () => {
    switch (ride.status) {
      case "accepted": return "En Route to Pickup";
      case "driver_en_route": return "Mark as Arrived";
      case "driver_arrived": return "Start Trip";
      default: return null;
    }
  };

  const advanceLabel = nextActionLabel();

  return (
    <Screen>
      <View style={styles.root}>
        <Mapbox.MapView style={StyleSheet.absoluteFill} styleURL={STYLE_URL}>
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: [ride.pickup_lng, ride.pickup_lat], zoomLevel: 14 }}
          />

          <Mapbox.PointAnnotation id="pickup" coordinate={[ride.pickup_lng, ride.pickup_lat]}>
            <View style={styles.markerPickup}>
              <Ionicons name="ellipse" size={10} color="#000" />
            </View>
          </Mapbox.PointAnnotation>

          <Mapbox.PointAnnotation id="dest" coordinate={[ride.destination_lng, ride.destination_lat]}>
            <View style={styles.markerDest}>
              <Ionicons name="location" size={26} color={COLORS.red} />
            </View>
          </Mapbox.PointAnnotation>
        </Mapbox.MapView>

        <View style={styles.panel}>
          <GlassCard style={styles.statusCard}>
            <Text style={styles.statusText}>{statusLabel(ride.status)}</Text>
            {ride.estimated_fare_cents ? (
              <Text style={styles.fareText}>Est. {formatFare(ride.estimated_fare_cents)}</Text>
            ) : null}
          </GlassCard>

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

          {/* Advance status button */}
          {advanceLabel && (
            <PrimaryButton
              label={actionLoading ? "Updating..." : advanceLabel}
              onPress={handleAdvance}
              disabled={actionLoading}
            />
          )}

          {/* Simulate movement (demo button) */}
          {ride.status === "in_progress" && (
            <PrimaryButton
              label={simulating ? "Simulating movement..." : "Simulate Driver Movement"}
              onPress={handleSimulateMovement}
              disabled={simulating || actionLoading}
            />
          )}

          {/* Complete ride */}
          {ride.status === "in_progress" && (
            <PrimaryButton
              label={actionLoading ? "Completing..." : "Complete Ride"}
              onPress={handleCompleteRide}
              disabled={actionLoading || simulating}
            />
          )}

          {/* Cancel (only before trip starts) */}
          {!["in_progress", "completed", "cancelled"].includes(ride.status) && (
            <PrimaryButton
              label="Cancel Trip"
              onPress={handleCancel}
              disabled={actionLoading}
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
    position: "absolute",
    bottom: 0, left: 0, right: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1,
    borderTopColor: "rgba(255,255,255,0.08)",
    padding: SPACE.md,
    paddingBottom: SPACE.xl,
    gap: SPACE.sm,
  },
  statusCard: { alignItems: "center", paddingVertical: SPACE.md },
  statusText: { color: COLORS.text, fontWeight: "900", fontSize: 18 },
  fareText: { color: COLORS.textDim, fontSize: 13, marginTop: 4 },
  locationBlock: { gap: 4 },
  locationRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  locationText: { flex: 1, color: COLORS.textDim, fontSize: 13 },
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
});