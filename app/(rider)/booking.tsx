import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, ScrollView, Pressable,
  ActivityIndicator, TextInput, FlatList,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Location from "expo-location";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import SwipeableSheet, { useSheetDragging } from "../../src/components/SwipeableSheet";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getSavedPlaces, SavedPlace } from "../../src/lib/savedPlaces";
import { reverseGeocode } from "../../src/lib/geocoding";
import { getRoute, requestRide, formatFare, demandLabel } from "../../src/lib/rides";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;
const STYLE_URL = "mapbox://styles/thandoluphoko9/cmauq6ss2001p01r20y0g444v";
const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041];

type LocationPoint = {
  label: string;
  address: string;
  lat: number;
  lng: number;
};

type SearchResult = {
  id: string;
  name: string;
  address: string;
  lat: number;
  lng: number;
};

export default function BookingScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const cameraRef = useRef<Mapbox.Camera>(null);

  const [pickup, setPickup] = useState<LocationPoint | null>(null);
  const [destination, setDestination] = useState<LocationPoint | null>(null);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);
  const [activeField, setActiveField] = useState<"pickup" | "destination" | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [estimatedFare, setEstimatedFare] = useState<number | null>(null);
  const [demandMultiplier] = useState<number>(1.1);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    (async () => {
      try {
        const [places, perm] = await Promise.all([
          getSavedPlaces(),
          Location.requestForegroundPermissionsAsync(),
        ]);
        setSavedPlaces(places);

        if (perm.status === "granted") {
          const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
          setPickup({
            label: "Current location",
            address: addr,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          });
          cameraRef.current?.setCamera?.({
            centerCoordinate: [pos.coords.longitude, pos.coords.latitude],
            zoomLevel: 14,
            animationMode: "flyTo",
            animationDuration: 800,
          });
        }
      } catch {
        // non-critical
      }
    })();
  }, []);

  useEffect(() => {
    if (!pickup || !destination) {
      setRouteGeoJSON(null);
      setEstimatedFare(null);
      return;
    }

    (async () => {
      try {
        const route = await getRoute(
          [pickup.lng, pickup.lat],
          [destination.lng, destination.lat]
        );
        setRouteGeoJSON(route.geometry);
        setEstimatedDistance(route.distanceKm);
        setEstimatedDuration(route.durationMin);

        const baseFare =
          (route.distanceKm * 400 + route.durationMin * 120) * 1.1 + 300;
        setEstimatedFare(Math.max(Math.round(baseFare), 2000));

        cameraRef.current?.fitBounds?.(
          [pickup.lng, pickup.lat],
          [destination.lng, destination.lat],
          [80, 80, 80, 80],
          800
        );
      } catch {
        // silent
      }
    })();
  }, [pickup, destination]);

  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) {
      setSearchResults([]);
      return;
    }

    const timeout = setTimeout(async () => {
      setSearching(true);
      try {
        const url =
          `https://api.mapbox.com/search/geocode/v6/forward` +
          `?q=${encodeURIComponent(searchQuery)}` +
          `&country=ZA&language=en&limit=5` +
          `&access_token=${MAPBOX_TOKEN}`;
        const res = await fetch(url);
        const json = await res.json();
        const results: SearchResult[] = (json.features ?? []).map((f: any) => ({
          id: f.id,
          name: f.properties?.name ?? f.properties?.full_address,
          address: f.properties?.full_address ?? "",
          lat: f.geometry?.coordinates?.[1],
          lng: f.geometry?.coordinates?.[0],
        }));
        setSearchResults(results);
      } catch {
        setSearchResults([]);
      } finally {
        setSearching(false);
      }
    }, 400);

    return () => clearTimeout(timeout);
  }, [searchQuery]);

  const selectSearchResult = (result: SearchResult) => {
    const point: LocationPoint = {
      label: result.name,
      address: result.address,
      lat: result.lat,
      lng: result.lng,
    };
    if (activeField === "pickup") setPickup(point);
    else setDestination(point);
    setActiveField(null);
    setSearchQuery("");
    setSearchResults([]);
  };

  const selectSavedPlace = (place: SavedPlace) => {
    const point: LocationPoint = {
      label: place.label,
      address: place.address,
      lat: place.latitude,
      lng: place.longitude,
    };
    if (activeField === "pickup") setPickup(point);
    else setDestination(point);
    setActiveField(null);
  };

  const handleRequestRide = async () => {
    if (!pickup || !destination || !estimatedDistance || !estimatedDuration) return;
    setError(null);
    setRequesting(true);
    try {
      const ride = await requestRide({
        pickupLabel: pickup.label,
        pickupAddress: pickup.address,
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        destinationLabel: destination.label,
        destinationAddress: destination.address,
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        estimatedDistanceKm: estimatedDistance,
        estimatedDurationMin: estimatedDuration,
      });
      router.replace({ pathname: "/(rider)/ride-tracking", params: { rideId: ride.id } });
    } catch (e: any) {
      setError(e?.message ?? "Failed to request ride.");
    } finally {
      setRequesting(false);
    }
  };

  const home = savedPlaces.find((p) => p.kind === "home");
  const work = savedPlaces.find((p) => p.kind === "work");
  const customs = savedPlaces.filter((p) => p.kind === "custom");
  const canRequest = !!pickup && !!destination;

  return (
    <Screen>
      <RiderHeader subtitle="Where to?" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />

      <View style={styles.root}>
        <Mapbox.MapView style={StyleSheet.absoluteFill} styleURL={STYLE_URL}>
            <Mapbox.Camera ref={cameraRef} defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: 13 }} />

            {pickup && (
              <Mapbox.PointAnnotation id="pickup" coordinate={[pickup.lng, pickup.lat]}>
                <View style={styles.markerPickup}>
                  <Ionicons name="ellipse" size={10} color="#000" />
                </View>
              </Mapbox.PointAnnotation>
            )}

            {destination && (
              <Mapbox.PointAnnotation id="destination" coordinate={[destination.lng, destination.lat]}>
                <View style={styles.markerDestination}>
                  <Ionicons name="location" size={26} color={COLORS.red} />
                </View>
              </Mapbox.PointAnnotation>
            )}

            {routeGeoJSON && (
              <Mapbox.ShapeSource id="route" shape={routeGeoJSON}>
                <Mapbox.LineLayer
                  id="routeLine"
                  style={{ lineColor: COLORS.red, lineWidth: 4, lineOpacity: 0.85 }}
                />
              </Mapbox.ShapeSource>
            )}
          </Mapbox.MapView>

        <SwipeableSheet topGap={120} defaultExpanded={true}>
          {activeField ? (
            <View style={styles.searchContainer}>
              <View style={styles.searchBar}>
                <Ionicons name="search-outline" size={18} color={COLORS.textFaint} />
                <TextInput
                  style={styles.searchInput}
                  placeholder={activeField === "pickup" ? "Enter pickup..." : "Enter destination..."}
                  placeholderTextColor={COLORS.textFaint}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  autoFocus
                />
                {searching && <ActivityIndicator size="small" color={COLORS.red} />}
              </View>

              <Pressable onPress={() => { setActiveField(null); setSearchQuery(""); }} style={styles.cancelSearch}>
                <Text style={{ color: COLORS.red, fontWeight: "700" }}>Cancel</Text>
              </Pressable>

              <FlatList
                data={searchResults}
                keyExtractor={(item) => item.id}
                style={{ maxHeight: 220 }}
                renderItem={({ item }) => (
                  <Pressable onPress={() => selectSearchResult(item)} style={styles.searchResult}>
                    <Ionicons name="location-outline" size={16} color={COLORS.red} style={{ marginTop: 2 }} />
                    <View style={{ flex: 1 }}>
                      <Text style={styles.searchResultName}>{item.name}</Text>
                      <Text style={styles.searchResultAddr} numberOfLines={1}>{item.address}</Text>
                    </View>
                  </Pressable>
                )}
                ListHeaderComponent={
                  savedPlaces.length > 0 && searchQuery.length === 0 ? (
                    <View style={{ gap: 6, marginBottom: 8 }}>
                      {home && (
                        <Pressable onPress={() => selectSavedPlace(home)} style={styles.savedRow}>
                          <Ionicons name="home-outline" size={16} color={COLORS.red} />
                          <Text style={styles.savedLabel}>Home</Text>
                        </Pressable>
                      )}
                      {work && (
                        <Pressable onPress={() => selectSavedPlace(work)} style={styles.savedRow}>
                          <Ionicons name="briefcase-outline" size={16} color={COLORS.red} />
                          <Text style={styles.savedLabel}>Work</Text>
                        </Pressable>
                      )}
                      {customs.map((p) => (
                        <Pressable key={p.id} onPress={() => selectSavedPlace(p)} style={styles.savedRow}>
                          <Ionicons name="star-outline" size={16} color={COLORS.red} />
                          <Text style={styles.savedLabel}>{p.label}</Text>
                        </Pressable>
                      ))}
                    </View>
                  ) : null
                }
              />
            </View>
          ) : (
            <ScrollView scrollEnabled={false} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
              <Pressable onPress={() => setActiveField("pickup")} style={styles.locationRow}>
                <View style={styles.dotPickup} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationLabel}>Pickup</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>
                    {pickup ? pickup.label : "Set pickup location"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textFaint} />
              </Pressable>

              <View style={styles.locationDivider} />

              <Pressable onPress={() => setActiveField("destination")} style={styles.locationRow}>
                <Ionicons name="location" size={18} color={COLORS.red} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.locationLabel}>Destination</Text>
                  <Text style={styles.locationValue} numberOfLines={1}>
                    {destination ? destination.label : "Where are you going?"}
                  </Text>
                </View>
                <Ionicons name="chevron-forward" size={16} color={COLORS.textFaint} />
              </Pressable>

              {estimatedFare && estimatedDistance && estimatedDuration ? (
                <GlassCard style={styles.fareCard}>
                  <View style={styles.fareRow}>
                    <Text style={styles.fareAmount}>{formatFare(estimatedFare)}</Text>
                    <View style={styles.demandBadge}>
                      <Text style={styles.demandText}>{demandLabel(demandMultiplier)}</Text>
                    </View>
                  </View>
                  <Text style={styles.fareDetails}>
                    {estimatedDistance.toFixed(1)} km · {Math.round(estimatedDuration)} min · estimated
                  </Text>
                </GlassCard>
              ) : null}

              {error ? <Text style={styles.error}>{error}</Text> : null}

              <View style={{ marginTop: SPACE.sm }}>
                <PrimaryButton
                  label={requesting ? "Requesting..." : "Request Ride"}
                  onPress={handleRequestRide}
                  disabled={!canRequest || requesting}
                />
              </View>
            </ScrollView>
          )}
        </SwipeableSheet>
      </View>

      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  locationRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingVertical: 12,
  },
  locationDivider: {
    height: 1,
    backgroundColor: "rgba(255,255,255,0.06)",
    marginLeft: 30,
  },
  dotPickup: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 2,
    borderColor: COLORS.text,
    backgroundColor: "transparent",
  },
  locationLabel: {
    color: COLORS.textFaint,
    fontSize: 11,
    fontWeight: "700",
    textTransform: "uppercase",
    letterSpacing: 0.5,
  },
  locationValue: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 2,
  },
  fareCard: { marginTop: SPACE.sm },
  fareRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  fareAmount: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  demandBadge: {
    backgroundColor: "rgba(255,46,46,0.12)",
    borderWidth: 1,
    borderColor: "rgba(255,46,46,0.3)",
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: RADIUS.pill,
  },
  demandText: { color: COLORS.red, fontSize: 11, fontWeight: "800" },
  fareDetails: { color: COLORS.textDim, fontSize: 12, marginTop: 4 },
  markerPickup: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: COLORS.text,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#000",
  },
  markerDestination: { alignItems: "center" },
  searchContainer: { flex: 1 },
  searchBar: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: RADIUS.xl,
    paddingHorizontal: SPACE.md,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
  },
  searchInput: {
    flex: 1,
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "600",
  },
  cancelSearch: { alignSelf: "flex-end", paddingVertical: 8 },
  searchResult: {
    flexDirection: "row",
    gap: SPACE.sm,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  searchResultName: { color: COLORS.text, fontWeight: "700", fontSize: 13 },
  searchResultAddr: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  savedRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: "rgba(255,255,255,0.05)",
  },
  savedLabel: { color: COLORS.text, fontWeight: "700", fontSize: 13 },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});