import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput,
  FlatList, ActivityIndicator, ScrollView, Alert,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { router, useFocusEffect } from "expo-router";

import DateTimePicker from "@react-native-community/datetimepicker";
import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import SwipeableSheet from "../../src/components/SwipeableSheet";
import DraggableSheet from "../../src/components/DraggableSheet";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import NearbyAlertBanner from "../../src/components/NearbyAlertBanner";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getSavedPlaces, SavedPlace } from "../../src/lib/savedPlaces";
import { reverseGeocode } from "../../src/lib/geocoding";
import {
  getRoute, requestRide, requestScheduledRide, formatFare, demandLabel,
  TIER_CONFIG, RideTier, getActiveRideForRider,
} from "../../src/lib/rides";
import { updateMyLocation } from "../../src/lib/presence";
import { haversineKm } from "../../src/lib/geo";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;
const STYLE_URL = "mapbox://styles/thandoluphoko9/cmqn0smkv00b001se3b9gf6g7";
// Distinct from the app's red accent (used for pins/UI) so the route reads
// clearly against the dark map style instead of blending into it.
const ROUTE_LINE_COLOR = "#3B9EFF";
const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041];

// Initialize Mapbox token before any MapView mounts
if (MAPBOX_TOKEN) Mapbox.setAccessToken(MAPBOX_TOKEN);

type Step = "sheet" | "input_pickup" | "input_destination" | "pin" | "tiers" | "requesting";
type LocationPoint = { label: string; address: string; lat: number; lng: number };
type SearchResult = { id: string; name: string; address: string; lat: number; lng: number };

const TIERS: RideTier[] = ["economy", "comfort", "xl"];

export default function RiderHome() {
  const [menuOpen, setMenuOpen] = useState(false);
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [step, setStep] = useState<Step>("sheet");

  // Location state
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [pickup, setPickup] = useState<LocationPoint | null>(null);
  const [destination, setDestination] = useState<LocationPoint | null>(null);
  const [stops, setStops] = useState<LocationPoint[]>([]);
  const [addingStop, setAddingStop] = useState(false);
  const [scheduling, setScheduling] = useState(false);
  const [scheduledFor, setScheduledFor] = useState<Date | null>(null);
  const [showSchedDate, setShowSchedDate] = useState(false);
  const [showSchedTime, setShowSchedTime] = useState(false);
  const [savedPlaces, setSavedPlaces] = useState<SavedPlace[]>([]);

  // Search state
  const [activeField, setActiveField] = useState<"pickup" | "destination">("destination");
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);

  // Pin state (when user drags map)
  const [pinCoords, setPinCoords] = useState<[number, number] | null>(null);
  const [geocodingPin, setGeocodingPin] = useState(false);

  // Route + fare state
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  const [demandMultiplier] = useState(1.1);
  const [selectedTier, setSelectedTier] = useState<RideTier>("economy");
  const [requesting, setRequesting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [routeRefining, setRouteRefining] = useState(false);

  // Sheet tab
  const [sheetTab, setSheetTab] = useState<"home" | "work" | "recent" | "safety">("home");

  // If the rider already has an active ride (e.g. they backgrounded the app,
  // or a previous request never got a driver), take them straight to it —
  // just like a real ride-hailing app, instead of letting a confusing
  // "already have an active ride" error surface later.
  useFocusEffect(useCallback(() => {
    let cancelled = false;
    getActiveRideForRider()
      .then((active) => {
        if (active && !cancelled) {
          router.replace({ pathname: "/(rider)/ride-tracking", params: { rideId: active.id } });
        }
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []));

  // Load GPS + saved places on mount
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
          const loc: LocationPoint = {
            label: "Current location",
            address: addr,
            lat: pos.coords.latitude,
            lng: pos.coords.longitude,
          };
          setCurrentLocation(loc);
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

  // Lightweight presence ping — lets proximity-based push (nearby public
  // SOS alerts) find a recent location for this rider. Silent/best-effort;
  // does nothing if location permission was never granted.
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

  // Instantly estimate + draw a straight-line route when both points are
  // set, then refine with the actual routed path in the background — the
  // rider never has to stare at a blank "calculating..." screen.
  useEffect(() => {
    if (!pickup || !destination) { setRouteGeoJSON(null); setRouteRefining(false); return; }

    const waypoints: LocationPoint[] = [pickup, ...stops, destination];

    // Instant straight-line estimate across every leg, padded the same way
    // as the single-destination case, while the real route is fetched.
    let straightKm = 0;
    for (let i = 0; i < waypoints.length - 1; i++) {
      straightKm += haversineKm(waypoints[i].lat, waypoints[i].lng, waypoints[i + 1].lat, waypoints[i + 1].lng);
    }
    const approxDistanceKm = straightKm * 1.3;
    const approxDurationMin = (approxDistanceKm / 28) * 60; // ~28 km/h average city speed

    setEstimatedDistance(approxDistanceKm);
    setEstimatedDuration(approxDurationMin);
    setRouteGeoJSON({
      type: "Feature",
      properties: {},
      geometry: {
        type: "LineString",
        coordinates: waypoints.map((w) => [w.lng, w.lat]),
      },
    } as any);
    setRouteRefining(true);

    cameraRef.current?.fitBounds?.(
      [pickup.lng, pickup.lat],
      [destination.lng, destination.lat],
      [100, 60, 280, 60],
      500
    );

    let cancelled = false;
    (async () => {
      try {
        const route = await getRoute(waypoints.map((w) => [w.lng, w.lat]));
        if (cancelled) return;
        setRouteGeoJSON(route.geometry);
        setEstimatedDistance(route.distanceKm);
        setEstimatedDuration(route.durationMin);

        // Fit to the full route geometry (not just the two endpoints) so a
        // curved road never gets clipped at the edges of the map.
        const coords: [number, number][] = route.geometry?.coordinates ?? [];
        if (coords.length > 0) {
          let minLng = coords[0][0], maxLng = coords[0][0];
          let minLat = coords[0][1], maxLat = coords[0][1];
          for (const [lng, lat] of coords) {
            if (lng < minLng) minLng = lng;
            if (lng > maxLng) maxLng = lng;
            if (lat < minLat) minLat = lat;
            if (lat > maxLat) maxLat = lat;
          }
          cameraRef.current?.fitBounds?.(
            [maxLng, maxLat],
            [minLng, minLat],
            [90, 50, 300, 50],
            700
          );
        }
      } catch {
        // keep the straight-line estimate — still useful, just less precise
      } finally {
        if (!cancelled) setRouteRefining(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pickup, destination, stops]);

  // Live address search with debounce
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) { setSearchResults([]); return; }
    const t = setTimeout(async () => {
      setSearching(true);
      try {
        const url = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(searchQuery)}&country=ZA&language=en&limit=6&access_token=${MAPBOX_TOKEN}`;
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
        // Preview first result on map
        if (results[0]) {
          cameraRef.current?.setCamera?.({
            centerCoordinate: [results[0].lng, results[0].lat],
            zoomLevel: 14,
            animationMode: "flyTo",
            animationDuration: 400,
          });
        }
      } catch { setSearchResults([]); }
      finally { setSearching(false); }
    }, 350);
    return () => clearTimeout(t);
  }, [searchQuery]);

  // Fully clears anything entered during the current booking attempt.
  // Used when the user backs out before confirming a route — without this,
  // the stale destination/route would still be sitting there next time they
  // open "Where to?".
  const resetBookingFlow = () => {
    setDestination(null);
    setPickup(null);
    setStops([]);
    setAddingStop(false);
    setScheduling(false);
    setScheduledFor(null);
    setRouteGeoJSON(null);
    setEstimatedDistance(null);
    setEstimatedDuration(null);
    setSearchQuery("");
    setSearchResults([]);
    setPinCoords(null);
    setError(null);
    setStep("sheet");
  };

  const confirmSearchResult = (result: SearchResult) => {
    const point: LocationPoint = { label: result.name, address: result.address, lat: result.lat, lng: result.lng };
    if (addingStop) {
      setStops((prev) => [...prev, point]);
      setAddingStop(false);
      setStep("tiers");
    } else if (activeField === "pickup") { setPickup(point); setStep("tiers"); }
    else { setDestination(point); setSearchQuery(""); setSearchResults([]); if (pickup) setStep("tiers"); else { setStep("input_pickup"); setActiveField("pickup"); } }
    setSearchQuery("");
    setSearchResults([]);
  };

  // forceField lets sheet quick-chips always set destination regardless of activeField
  const confirmSavedPlace = (place: SavedPlace, forceField?: "pickup" | "destination") => {
    const field = forceField ?? activeField;
    const point: LocationPoint = { label: place.label, address: place.address, lat: place.latitude, lng: place.longitude };
    if (field === "pickup") { setPickup(point); setStep("tiers"); }
    else { setDestination(point); if (pickup) setStep("tiers"); else { setStep("input_pickup"); setActiveField("pickup"); } }
  };

  // Home/Work tabs always set DESTINATION — pickup is handled separately
  const handleHomeTab = () => {
    const home = savedPlaces.find((p) => p.kind === "home");
    if (home) {
      setDestination({ label: "Home", address: home.address, lat: home.latitude, lng: home.longitude });
      if (pickup) setStep("tiers");
      else { setStep("input_pickup"); setActiveField("pickup"); }
    } else {
      Alert.alert("No home saved", "Go to Settings → Saved Places to set your Home address.");
    }
  };

  const handleWorkTab = () => {
    const work = savedPlaces.find((p) => p.kind === "work");
    if (work) {
      setDestination({ label: "Work", address: work.address, lat: work.latitude, lng: work.longitude });
      if (pickup) setStep("tiers");
      else { setStep("input_pickup"); setActiveField("pickup"); }
    } else {
      Alert.alert("No work saved", "Go to Settings → Saved Places to set your Work address.");
    }
  };

  // Pin mode: user drags map, pin stays fixed in center
  const startPinMode = (field: "pickup" | "destination") => {
    setActiveField(field);
    setStep("pin");
    setPinCoords(null);
  };

  const confirmPin = async () => {
    if (!pinCoords) return;
    setGeocodingPin(true);
    try {
      const addr = await reverseGeocode(pinCoords[1], pinCoords[0]);
      const point: LocationPoint = { label: "Pinned location", address: addr, lat: pinCoords[1], lng: pinCoords[0] };
      if (activeField === "pickup") {
        setPickup(point);
        setStep("tiers"); // destination is always already set by the time pickup is being pinned
      } else {
        setDestination(point);
        if (pickup) setStep("tiers");
        else { setStep("input_pickup"); setActiveField("pickup"); }
      }
    } catch {
      setGeocodingPin(false);
    } finally {
      setGeocodingPin(false);
    }
  };

  const tierFare = (tier: RideTier): number => {
    if (!estimatedDistance || !estimatedDuration) return 2000;
    const base = (estimatedDistance * 400 + estimatedDuration * 120) * demandMultiplier;
    const fare = base * TIER_CONFIG[tier].multiplier + 300;
    return Math.max(Math.round(fare), 2000);
  };

  const handleRequestRide = async () => {
    if (!pickup || !destination || !estimatedDistance || !estimatedDuration) return;
    if (scheduling && !scheduledFor) {
      Alert.alert("Pick a time", "Choose a date and time for your scheduled ride.");
      return;
    }
    setError(null);
    setStep("requesting");
    setRequesting(true);
    try {
      const commonParams = {
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
        rideTier: selectedTier,
        stops: stops.map((s) => ({ label: s.label, address: s.address, lat: s.lat, lng: s.lng })),
      };

      if (scheduling && scheduledFor) {
        await requestScheduledRide({ ...commonParams, scheduledFor });
        Alert.alert(
          "Ride Scheduled",
          `Your ride is booked for ${scheduledFor.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })} at ${scheduledFor.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}. You can view or cancel it from Scheduled Rides.`
        );
        resetBookingFlow();
        return;
      }

      const ride = await requestRide(commonParams);
      router.replace({ pathname: "/(rider)/ride-tracking", params: { rideId: ride.id } });
    } catch (e: any) {
      // If this failed because we already have an active ride (e.g. a race
      // with the focus-effect check above), go to it instead of dead-ending.
      try {
        const active = await getActiveRideForRider();
        if (active) {
          router.replace({ pathname: "/(rider)/ride-tracking", params: { rideId: active.id } });
          return;
        }
      } catch { /* fall through to showing the error below */ }
      setError(e?.message ?? "Failed to request ride.");
      setStep("tiers");
    } finally {
      setRequesting(false);
    }
  };

  const home = savedPlaces.find((p) => p.kind === "home");
  const work = savedPlaces.find((p) => p.kind === "work");
  const customs = savedPlaces.filter((p) => p.kind === "custom");

  return (
    <Screen>
      <RiderHeader subtitle="Where to?" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />

      <View style={styles.root}>
        {/* ── MAP ── */}
        <Mapbox.MapView
          style={StyleSheet.absoluteFill}
          styleURL={STYLE_URL}
          onCameraChanged={(state: any) => {
            if (step === "pin") {
              const c = state?.properties?.center;
              if (c) setPinCoords([c[0], c[1]]);
            }
          }}
        >
          <Mapbox.Camera
            ref={cameraRef}
            defaultSettings={{ centerCoordinate: DEFAULT_CENTER, zoomLevel: 13 }}
          />

          {/* Pickup marker */}
          {pickup && step !== "pin" && (
            <Mapbox.PointAnnotation id="pickup" coordinate={[pickup.lng, pickup.lat]}>
              <View style={styles.markerPickup}>
                <Ionicons name="ellipse" size={10} color="#000" />
              </View>
            </Mapbox.PointAnnotation>
          )}

          {/* Stop markers */}
          {step !== "pin" && stops.map((stop, i) => (
            <Mapbox.PointAnnotation key={i} id={`stop-${i}`} coordinate={[stop.lng, stop.lat]}>
              <View style={styles.markerStop}>
                <Text style={styles.markerStopTxt}>{i + 1}</Text>
              </View>
            </Mapbox.PointAnnotation>
          ))}

          {/* Destination marker */}
          {destination && step !== "pin" && (
            <Mapbox.PointAnnotation id="dest" coordinate={[destination.lng, destination.lat]}>
              <View style={styles.markerDest}>
                <Ionicons name="location" size={28} color={COLORS.red} />
              </View>
            </Mapbox.PointAnnotation>
          )}

          {/* Route line */}
          {routeGeoJSON && (
            <Mapbox.ShapeSource id="route" shape={routeGeoJSON}>
              {/* Dark casing underneath for contrast on any map background */}
              <Mapbox.LineLayer
                id="routeLineCasing"
                style={{ lineColor: "#0a0a0a", lineWidth: 8, lineOpacity: 0.6, lineCap: "round", lineJoin: "round" }}
              />
              <Mapbox.LineLayer
                id="routeLine"
                style={{ lineColor: ROUTE_LINE_COLOR, lineWidth: 5, lineOpacity: 1, lineCap: "round", lineJoin: "round" }}
              />
            </Mapbox.ShapeSource>
          )}
        </Mapbox.MapView>

        {/* ── FIXED CENTER PIN (pin mode only) ── */}
        {step === "pin" && (
          <View style={styles.fixedPinWrap} pointerEvents="none">
            <Ionicons name="location" size={42} color={COLORS.red} />
            <View style={styles.pinShadow} />
          </View>
        )}

        {/* ── PIN MODE CONFIRM ── */}
        {step === "pin" && (
          <View style={styles.pinConfirmWrap}>
            <Text style={styles.pinInstruction}>Drag map to position pin</Text>
            <PrimaryButton
              label={geocodingPin ? "Confirming..." : "Confirm Pin"}
              onPress={confirmPin}
              disabled={geocodingPin || !pinCoords}
            />
            <Pressable onPress={resetBookingFlow} style={styles.cancelBtn}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {/* ── SWIPEABLE SHEET (home tab view) ── */}
        {step === "sheet" && (
          <SwipeableSheet
            topGap={120}
            defaultExpanded
            defaultTab="home"
            onTabChange={(tab) => {
              setSheetTab(tab as any);
              if (tab === "home") handleHomeTab();
              else if (tab === "work") handleWorkTab();
            }}
          >
            <View style={{ gap: SPACE.sm }}>
              <NearbyAlertBanner />

              {/* Where to? input trigger */}
              <Pressable
                style={styles.whereToBtn}
                onPress={() => { setActiveField("destination"); setStep("input_destination"); }}
              >
                <Ionicons name="search-outline" size={18} color={COLORS.textFaint} />
                <Text style={styles.whereToBtnTxt}>Where to?</Text>
              </Pressable>

              {/* Quick access saved places */}
              {(home || work || customs.length > 0) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  <View style={styles.quickRow}>
                    {home && (
                      <Pressable style={styles.quickChip} onPress={() => confirmSavedPlace(home)}>
                        <Ionicons name="home-outline" size={15} color={COLORS.red} />
                        <Text style={styles.quickChipTxt}>Home</Text>
                      </Pressable>
                    )}
                    {work && (
                      <Pressable style={styles.quickChip} onPress={() => confirmSavedPlace(work)}>
                        <Ionicons name="briefcase-outline" size={15} color={COLORS.red} />
                        <Text style={styles.quickChipTxt}>Work</Text>
                      </Pressable>
                    )}
                    {customs.map((p) => (
                      <Pressable key={p.id} style={styles.quickChip} onPress={() => confirmSavedPlace(p)}>
                        <Ionicons name="star-outline" size={15} color={COLORS.red} />
                        <Text style={styles.quickChipTxt}>{p.label}</Text>
                      </Pressable>
                    ))}
                    <Pressable style={styles.quickChip} onPress={() => router.push("/(rider)/scheduled-rides")}>
                      <Ionicons name="calendar-outline" size={15} color={COLORS.red} />
                      <Text style={styles.quickChipTxt}>Scheduled</Text>
                    </Pressable>
                  </View>
                </ScrollView>
              )}
            </View>
          </SwipeableSheet>
        )}

        {/* ── INPUT STEP (search + suggestions) ── */}
        {(step === "input_pickup" || step === "input_destination") && (
          <View style={styles.inputPanel}>
            {step === "input_destination" ? (
              <Text style={styles.inputStepTitle}>{addingStop ? "Add a stop" : "Where to?"}</Text>
            ) : (
              <View style={styles.pickupContext}>
                <Ionicons name="location" size={14} color={COLORS.red} />
                <Text style={styles.pickupContextTxt} numberOfLines={1}>To: {destination?.label}</Text>
              </View>
            )}

            {/* Search field */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={16} color={COLORS.textFaint} />
              <TextInput
                style={styles.searchInput}
                placeholder={step === "input_pickup" ? "Search pickup location..." : addingStop ? "Search for a stop..." : "Search destination..."}
                placeholderTextColor={COLORS.textFaint}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
              {searching && <ActivityIndicator size="small" color={COLORS.red} />}
            </View>

            {/* Pin option */}
            <Pressable style={styles.pinOption} onPress={() => startPinMode(activeField)}>
              <Ionicons name="location-outline" size={16} color={COLORS.red} />
              <Text style={styles.pinOptionTxt}>Drop a pin on the map</Text>
            </Pressable>

            {/* Suggestions */}
            <FlatList
              data={searchResults}
              keyExtractor={(item) => item.id}
              style={{ maxHeight: 260 }}
              keyboardShouldPersistTaps="handled"
              ListHeaderComponent={
                searchQuery.length < 3 ? (
                  <View style={{ gap: 2 }}>
                    {step === "input_pickup" && currentLocation && (
                      <Pressable style={styles.suggestion} onPress={() => confirmSearchResult({ id: "cur", name: "Current location", address: currentLocation.address, lat: currentLocation.lat, lng: currentLocation.lng })}>
                        <Ionicons name="navigate-outline" size={16} color={COLORS.red} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suggestionName}>Current location</Text>
                          <Text style={styles.suggestionAddr} numberOfLines={1}>{currentLocation.address}</Text>
                        </View>
                      </Pressable>
                    )}
                    {savedPlaces.map((p) => (
                      <Pressable key={p.id} style={styles.suggestion} onPress={() => confirmSavedPlace(p)}>
                        <Ionicons name={p.kind === "home" ? "home-outline" : p.kind === "work" ? "briefcase-outline" : "star-outline"} size={16} color={COLORS.red} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suggestionName}>{p.label}</Text>
                          <Text style={styles.suggestionAddr} numberOfLines={1}>{p.address}</Text>
                        </View>
                      </Pressable>
                    ))}
                  </View>
                ) : null
              }
              renderItem={({ item }) => (
                <Pressable style={styles.suggestion} onPress={() => confirmSearchResult(item)}>
                  <Ionicons name="location-outline" size={16} color={COLORS.red} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.suggestionName}>{item.name}</Text>
                    <Text style={styles.suggestionAddr} numberOfLines={1}>{item.address}</Text>
                  </View>
                </Pressable>
              )}
            />

            <Pressable
              onPress={() => {
                if (addingStop) {
                  setAddingStop(false);
                  setSearchQuery("");
                  setSearchResults([]);
                  setStep("tiers");
                } else {
                  resetBookingFlow();
                }
              }}
              style={styles.cancelBtn}
            >
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {/* ── TIER SELECTION ── */}
        {(step === "tiers" || step === "requesting") && pickup && destination && (
          <DraggableSheet topGap={140} peekHeight={110}>
            {/* Trip summary */}
            <View style={styles.tripSummaryRow}>
              <View style={styles.dotPickup} />
              <Text style={styles.tripSummaryTxt} numberOfLines={1}>{pickup.label}</Text>
            </View>
            {stops.map((stop, i) => (
              <View key={i} style={[styles.tripSummaryRow, { marginTop: 6 }]}>
                <Ionicons name="ellipse" size={8} color={COLORS.textFaint} />
                <Text style={styles.tripSummaryTxt} numberOfLines={1}>{stop.label}</Text>
                <Pressable onPress={() => setStops((prev) => prev.filter((_, idx) => idx !== i))}>
                  <Ionicons name="close-circle" size={16} color={COLORS.textFaint} />
                </Pressable>
              </View>
            ))}
            <View style={[styles.tripSummaryRow, { marginTop: 6 }]}>
              <Ionicons name="location" size={14} color={COLORS.red} />
              <Text style={styles.tripSummaryTxt} numberOfLines={1}>{destination.label}</Text>
            </View>
            {stops.length < 3 && (
              <Pressable
                style={styles.addStopBtn}
                onPress={() => { setAddingStop(true); setActiveField("destination"); setStep("input_destination"); }}
              >
                <Ionicons name="add-circle-outline" size={16} color={COLORS.red} />
                <Text style={styles.addStopTxt}>Add a stop</Text>
              </Pressable>
            )}
            {estimatedDistance && estimatedDuration ? (
              <View style={styles.tripMetaRow}>
                <Text style={styles.tripMeta}>
                  {estimatedDistance.toFixed(1)} km · {Math.round(estimatedDuration)} min · {demandLabel(demandMultiplier)}
                </Text>
                {routeRefining && <ActivityIndicator size="small" color={COLORS.textFaint} />}
              </View>
            ) : null}

            {/* Tier options */}
            <View style={{ gap: SPACE.sm, marginTop: SPACE.sm }}>
              {TIERS.map((tier) => {
                const cfg = TIER_CONFIG[tier];
                const fare = tierFare(tier);
                const isSelected = selectedTier === tier;
                return (
                  <Pressable
                    key={tier}
                    style={[styles.tierCard, isSelected && styles.tierCardSelected]}
                    onPress={() => setSelectedTier(tier)}
                  >
                    <View style={styles.tierIconWrap}>
                      <Ionicons name={cfg.icon as any} size={22} color={isSelected ? "#000" : COLORS.text} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.tierLabel}>{cfg.label}</Text>
                      <Text style={styles.tierDesc}>{cfg.description}</Text>
                    </View>
                    <Text style={styles.tierFare}>{formatFare(fare)}</Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* Schedule for later */}
            <Pressable
              style={styles.scheduleToggle}
              onPress={() => {
                if (scheduling) {
                  setScheduling(false);
                  setScheduledFor(null);
                } else {
                  setScheduling(true);
                  setShowSchedDate(true);
                }
              }}
            >
              <Ionicons name="calendar-outline" size={16} color={scheduling ? COLORS.red : COLORS.textDim} />
              <Text style={[styles.scheduleToggleTxt, scheduling && { color: COLORS.red }]}>
                {scheduledFor
                  ? `Scheduled for ${scheduledFor.toLocaleDateString("en-ZA", { day: "2-digit", month: "short" })} · ${scheduledFor.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}`
                  : "Schedule for later"}
              </Text>
              {scheduling && (
                <Ionicons name="close-circle" size={16} color={COLORS.textFaint} style={{ marginLeft: "auto" }} />
              )}
            </Pressable>

            {showSchedDate && (
              <DateTimePicker
                value={scheduledFor ?? new Date(Date.now() + 60 * 60 * 1000)}
                mode="date"
                display="default"
                minimumDate={new Date()}
                onChange={(_, selected) => {
                  setShowSchedDate(false);
                  if (selected) {
                    setScheduledFor(selected);
                    setShowSchedTime(true);
                  } else if (!scheduledFor) {
                    setScheduling(false);
                  }
                }}
              />
            )}
            {showSchedTime && (
              <DateTimePicker
                value={scheduledFor ?? new Date(Date.now() + 60 * 60 * 1000)}
                mode="time"
                display="default"
                onChange={(_, selected) => {
                  setShowSchedTime(false);
                  if (selected && scheduledFor) {
                    const combined = new Date(scheduledFor);
                    combined.setHours(selected.getHours(), selected.getMinutes());
                    setScheduledFor(combined);
                  } else if (!scheduledFor) {
                    setScheduling(false);
                  }
                }}
              />
            )}

            <View style={{ marginTop: SPACE.sm, gap: SPACE.sm }}>
              <PrimaryButton
                label={
                  requesting
                    ? (scheduling ? "Scheduling..." : "Finding your driver...")
                    : (scheduling ? "Schedule Ride" : "Request Ride")
                }
                onPress={handleRequestRide}
                disabled={requesting}
              />
              <Pressable onPress={() => setStep("input_destination")} style={styles.cancelBtn}>
                <Text style={styles.cancelTxt}>Change route</Text>
              </Pressable>
            </View>
          </DraggableSheet>
        )}
      </View>

      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="rider" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },

  // Markers
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
  markerStopTxt: { color: "#000", fontWeight: "900", fontSize: 11 },

  // Fixed pin
  fixedPinWrap: {
    position: "absolute", top: "50%", left: "50%",
    marginLeft: -21, marginTop: -42,
    alignItems: "center",
  },
  pinShadow: {
    width: 8, height: 4, borderRadius: 4,
    backgroundColor: "rgba(0,0,0,0.3)",
    marginTop: 2,
  },

  // Pin confirm
  pinConfirmWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    padding: SPACE.md, paddingBottom: SPACE.xl, gap: SPACE.sm,
  },
  pinInstruction: {
    color: COLORS.textDim, fontSize: 13, textAlign: "center",
  },

  // Where to button (sheet)
  whereToBtn: {
    flexDirection: "row", alignItems: "center", gap: SPACE.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: RADIUS.xl, paddingHorizontal: SPACE.md, paddingVertical: 14,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.1)",
  },
  whereToBtnTxt: { color: COLORS.textFaint, fontSize: 15, fontWeight: "600" },

  // Quick chips
  quickRow: { flexDirection: "row", gap: SPACE.sm, paddingHorizontal: 4 },
  quickChip: {
    flexDirection: "row", alignItems: "center", gap: 6,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: RADIUS.pill, paddingHorizontal: 14, paddingVertical: 10,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  quickChipTxt: { color: COLORS.text, fontWeight: "700", fontSize: 13 },

  // Input panel
  inputPanel: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    padding: SPACE.md, paddingBottom: SPACE.xl, gap: SPACE.sm,
  },
  inputStepTitle: { color: COLORS.text, fontWeight: "900", fontSize: 20 },
  pickupContext: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)", borderRadius: RADIUS.lg,
    paddingHorizontal: SPACE.sm, paddingVertical: 10,
  },
  pickupContextTxt: { flex: 1, color: COLORS.textDim, fontSize: 13, fontWeight: "700" },
  dotPickup: {
    width: 14, height: 14, borderRadius: 7,
    borderWidth: 2, borderColor: COLORS.text, backgroundColor: "transparent",
  },

  // Search bar
  searchBar: {
    flexDirection: "row", alignItems: "center", gap: SPACE.sm,
    backgroundColor: "rgba(255,255,255,0.06)",
    borderRadius: RADIUS.xl, paddingHorizontal: SPACE.md, paddingVertical: 12,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  searchInput: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "600" },

  // Pin option
  pinOption: {
    flexDirection: "row", alignItems: "center", gap: SPACE.sm,
    paddingVertical: 8,
  },
  pinOptionTxt: { color: COLORS.red, fontWeight: "700", fontSize: 13 },

  // Suggestions
  suggestion: {
    flexDirection: "row", alignItems: "flex-start", gap: SPACE.sm,
    paddingVertical: 12,
    borderBottomWidth: 1, borderBottomColor: "rgba(255,255,255,0.05)",
  },
  suggestionName: { color: COLORS.text, fontWeight: "700", fontSize: 13 },
  suggestionAddr: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },

  // Cancel
  cancelBtn: { alignItems: "center", paddingVertical: 8 },
  cancelTxt: { color: COLORS.red, fontWeight: "700", fontSize: 14 },

  // Tier panel
  tripSummaryRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  tripSummaryTxt: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  addStopBtn: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8, alignSelf: "flex-start" },
  addStopTxt: { color: COLORS.red, fontWeight: "800", fontSize: 13 },
  scheduleToggle: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.md, paddingHorizontal: 14, paddingVertical: 12,
  },
  scheduleToggleTxt: { color: COLORS.textDim, fontWeight: "700", fontSize: 13 },
  tripMetaRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 4, paddingLeft: 22 },
  tripMeta: { color: COLORS.textFaint, fontSize: 12 },

  // Tier cards
  tierCard: {
    flexDirection: "row", alignItems: "center", gap: SPACE.sm,
    padding: SPACE.md, borderRadius: RADIUS.xl,
    backgroundColor: "rgba(255,255,255,0.04)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  tierCardSelected: {
    borderColor: COLORS.red,
    backgroundColor: "rgba(255,46,46,0.08)",
  },
  tierIconWrap: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.06)",
    alignItems: "center", justifyContent: "center",
  },
  tierLabel: { color: COLORS.text, fontWeight: "900", fontSize: 15 },
  tierDesc: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  tierFare: { color: COLORS.text, fontWeight: "900", fontSize: 16 },

  error: {
    color: "rgba(255,90,90,0.95)", marginTop: SPACE.sm,
    fontWeight: "700", textAlign: "center",
  },
});