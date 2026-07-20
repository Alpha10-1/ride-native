import React, { useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Alert, Linking, Pressable } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import SOSFab from "../../src/components/SOSFab";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  Ride, getRideById, subscribeToRide,
  advanceRideStatus, completeRide, cancelRide,
  updateDriverLocation, formatFare, statusLabel,
  RideStop, getRideStops, markStopReached,
} from "../../src/lib/rides";

const STYLE_URL = "mapbox://styles/thandoluphoko9/cmqn0smkv00b001se3b9gf6g7";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;
if (MAPBOX_TOKEN) Mapbox.setAccessToken(MAPBOX_TOKEN);

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
  const [stops, setStops] = useState<RideStop[]>([]);
  const [markingStop, setMarkingStop] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [simulating, setSimulating] = useState(false);
  const [tripStartTime, setTripStartTime] = useState<Date | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!rideId) {
      setError("No ride reference was passed to this screen.");
      return;
    }
    let cancelled = false;
    getRideById(rideId)
      .then((r) => {
        if (cancelled) return;
        if (r) {
          setRide(r);
          if (r.trip_started_at) setTripStartTime(new Date(r.trip_started_at));
          // Center map on pickup initially
          cameraRef.current?.setCamera?.({
            centerCoordinate: [r.pickup_lng, r.pickup_lat],
            zoomLevel: 14,
            animationDuration: 0,
          });
        } else {
          setError("Couldn't find that trip. It may have been removed.");
        }
      })
      .catch((e: any) => {
        if (!cancelled) setError(e?.message ?? "Failed to load trip details.");
      });

    getRideStops(rideId)
      .then((s) => { if (!cancelled) setStops(s); })
      .catch(() => {});

    const unsub = subscribeToRide(rideId, (updated) => {
      setRide(updated);
    });
    return () => {
      cancelled = true;
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

  // Navigation target depends on where the driver is in the trip:
  // pickup while heading to/waiting for the rider; then, once in progress,
  // the next unreached stop in order, and finally the destination.
  const navTarget = (): { lat: number; lng: number } | null => {
    if (!ride) return null;
    if (ride.status === "in_progress") {
      const nextStop = stops.find((s) => !s.reached_at);
      if (nextStop) return { lat: nextStop.lat, lng: nextStop.lng };
      return { lat: ride.destination_lat, lng: ride.destination_lng };
    }
    if (ride.status === "accepted" || ride.status === "driver_en_route" || ride.status === "driver_arrived") {
      return { lat: ride.pickup_lat, lng: ride.pickup_lng };
    }
    return null;
  };

  const handleMarkStopReached = async (stopId: string) => {
    if (!ride) return;
    setMarkingStop(stopId);
    try {
      const updated = await markStopReached(ride.id, stopId);
      setStops((prev) => prev.map((s) => (s.id === updated.id ? updated : s)));
    } catch (e: any) {
      Alert.alert("Couldn't update stop", e?.message ?? "Please try again.");
    } finally {
      setMarkingStop(null);
    }
  };

  const handleNavigate = async () => {
    const target = navTarget();
    if (!target) return;
    const wazeUrl = `waze://?ll=${target.lat},${target.lng}&navigate=yes`;
    const wazeWebUrl = `https://waze.com/ul?ll=${target.lat},${target.lng}&navigate=yes`;
    try {
      const canOpenWaze = await Linking.canOpenURL(wazeUrl);
      if (canOpenWaze) {
        await Linking.openURL(wazeUrl);
      } else {
        await Linking.openURL(wazeWebUrl);
      }
    } catch {
      Alert.alert("Couldn't open Waze", "Make sure Waze is installed, or open it manually to navigate.");
    }
  };

  const handleCompleteRide = async () => {
    if (!ride) return;

    const unreached = stops.filter((s) => !s.reached_at);
    if (unreached.length > 0) {
      Alert.alert(
        "Stops not marked as reached",
        `You still have ${unreached.length} stop${unreached.length > 1 ? "s" : ""} not marked as visited. Complete the trip anyway?`,
        [
          { text: "Go back", style: "cancel" },
          { text: "Complete anyway", style: "destructive", onPress: () => finishRide() },
        ]
      );
      return;
    }
    finishRide();
  };

  const finishRide = async () => {
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

  if (error) {
    return (
      <Screen>
        <View style={styles.centerFill}>
          <Ionicons name="alert-circle" size={40} color="rgba(255,90,90,0.9)" />
          <Text style={{ color: COLORS.textDim, marginTop: SPACE.sm, textAlign: "center", paddingHorizontal: SPACE.lg }}>
            {error}
          </Text>
          <View style={{ height: SPACE.md }} />
          <PrimaryButton label="Back to Dashboard" onPress={() => router.replace("/(driver)/home")} />
        </View>
      </Screen>
    );
  }

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

          {stops.map((stop, i) => (
            <Mapbox.PointAnnotation key={stop.id} id={`stop-${stop.id}`} coordinate={[stop.lng, stop.lat]}>
              <View style={[styles.markerStop, stop.reached_at && styles.markerStopReached]}>
                <Text style={styles.markerStopTxt}>{stop.reached_at ? "✓" : i + 1}</Text>
              </View>
            </Mapbox.PointAnnotation>
          ))}

          <Mapbox.PointAnnotation id="dest" coordinate={[ride.destination_lng, ride.destination_lat]}>
            <View style={styles.markerDest}>
              <Ionicons name="location" size={26} color={COLORS.red} />
            </View>
          </Mapbox.PointAnnotation>
        </Mapbox.MapView>

        <SOSFab rideId={ride.id} />

        <View style={styles.panel}>
          <GlassCard style={styles.statusCard}>
            <Text style={styles.statusText}>{statusLabel(ride.status)}</Text>
            {ride.estimated_fare_cents ? (
              <Text style={styles.fareText}>Est. {formatFare(ride.estimated_fare_cents)}</Text>
            ) : null}
          </GlassCard>

          {stops.length > 0 && ride.status === "in_progress" && (
            <GlassCard style={{ gap: 10 }}>
              <Text style={styles.stopsHeading}>Stops</Text>
              {stops.map((stop, i) => (
                <View key={stop.id} style={styles.stopRow}>
                  <View style={[styles.stopNumber, stop.reached_at && styles.stopNumberDone]}>
                    <Text style={styles.stopNumberTxt}>{stop.reached_at ? "✓" : i + 1}</Text>
                  </View>
                  <Text style={styles.stopAddress} numberOfLines={1}>{stop.address}</Text>
                  {!stop.reached_at && (
                    <Pressable
                      style={styles.reachedBtn}
                      disabled={markingStop === stop.id}
                      onPress={() => handleMarkStopReached(stop.id)}
                    >
                      <Text style={styles.reachedBtnTxt}>
                        {markingStop === stop.id ? "..." : "Reached"}
                      </Text>
                    </Pressable>
                  )}
                </View>
              ))}
            </GlassCard>
          )}

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

          {/* Turn-by-turn navigation via Waze */}
          {navTarget() && (
            <PrimaryButton
              label="Navigate with Waze"
              onPress={handleNavigate}
            />
          )}

          <PrimaryButton
            label="Message Rider"
            onPress={() => router.push({ pathname: "/(driver)/ride-chat", params: { rideId: ride.id } })}
            danger
          />

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
  markerStop: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: COLORS.red, alignItems: "center", justifyContent: "center",
    borderWidth: 2, borderColor: "#000",
  },
  markerStopReached: { backgroundColor: "rgba(120,220,150,0.95)" },
  markerStopTxt: { color: "#000", fontWeight: "900", fontSize: 11 },
  stopsHeading: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  stopRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  stopNumber: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: "rgba(255,255,255,0.10)", alignItems: "center", justifyContent: "center",
  },
  stopNumberDone: { backgroundColor: "rgba(120,220,150,0.95)" },
  stopNumberTxt: { color: COLORS.text, fontWeight: "900", fontSize: 11 },
  stopAddress: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  reachedBtn: {
    height: 34, paddingHorizontal: 14, borderRadius: RADIUS.md,
    backgroundColor: COLORS.red, alignItems: "center", justifyContent: "center",
  },
  reachedBtnTxt: { color: "#000", fontWeight: "900", fontSize: 12 },
});