import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  View, Text, StyleSheet, Pressable, TextInput,
  FlatList, ActivityIndicator, ScrollView, Alert,
} from "react-native";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import SwipeableSheet from "../../src/components/SwipeableSheet";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getSavedPlaces, SavedPlace } from "../../src/lib/savedPlaces";
import { reverseGeocode } from "../../src/lib/geocoding";
import { getRoute, requestRide, formatFare, demandLabel, TIER_CONFIG, RideTier } from "../../src/lib/rides";

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string;
const STYLE_URL = "mapbox://styles/thandoluphoko9/cmauq6ss2001p01r20y0g444v";
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

  // Sheet tab
  const [sheetTab, setSheetTab] = useState<"home" | "work" | "recent" | "safety">("home");

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
          setPickup(loc);
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

  // Fetch route when both pickup + destination are set
  useEffect(() => {
    if (!pickup || !destination) { setRouteGeoJSON(null); return; }
    (async () => {
      try {
        const route = await getRoute([pickup.lng, pickup.lat], [destination.lng, destination.lat]);
        setRouteGeoJSON(route.geometry);
        setEstimatedDistance(route.distanceKm);
        setEstimatedDuration(route.durationMin);
        cameraRef.current?.fitBounds?.(
          [pickup.lng, pickup.lat],
          [destination.lng, destination.lat],
          [100, 60, 280, 60],
          800
        );
      } catch { /* silent */ }
    })();
  }, [pickup, destination]);

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

  const confirmSearchResult = (result: SearchResult) => {
    const point: LocationPoint = { label: result.name, address: result.address, lat: result.lat, lng: result.lng };
    if (activeField === "pickup") setPickup(point); else setDestination(point);
    setSearchQuery("");
    setSearchResults([]);
    if (activeField === "destination" && pickup) {
      setStep("tiers");
    } else {
      setStep("input_destination");
      setActiveField("destination");
    }
  };

  const confirmSavedPlace = (place: SavedPlace) => {
    const point: LocationPoint = { label: place.label, address: place.address, lat: place.latitude, lng: place.longitude };
    if (activeField === "pickup") setPickup(point); else setDestination(point);
    setSearchQuery("");
    if (activeField === "destination" && pickup) setStep("tiers");
    else { setStep("input_destination"); setActiveField("destination"); }
  };

  // When user taps Home tab — auto-fill destination with saved home
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
      if (activeField === "pickup") setPickup(point); else setDestination(point);
      if (activeField === "destination" && pickup) setStep("tiers");
      else { setStep("input_destination"); setActiveField("destination"); }
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
    setError(null);
    setStep("requesting");
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
        rideTier: selectedTier,
      });
      router.replace({ pathname: "/(rider)/ride-tracking", params: { rideId: ride.id } });
    } catch (e: any) {
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
              <Mapbox.LineLayer
                id="routeLine"
                style={{ lineColor: COLORS.red, lineWidth: 4, lineOpacity: 0.85 }}
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
            <Pressable onPress={() => setStep("sheet")} style={styles.cancelBtn}>
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
                  </View>
                </ScrollView>
              )}
            </View>
          </SwipeableSheet>
        )}

        {/* ── INPUT STEP (search + suggestions) ── */}
        {(step === "input_pickup" || step === "input_destination") && (
          <View style={styles.inputPanel}>
            {/* Input rows */}
            <View style={styles.inputRows}>
              {/* Pickup row */}
              <Pressable
                style={[styles.inputRow, activeField === "pickup" && styles.inputRowActive]}
                onPress={() => { setActiveField("pickup"); setSearchQuery(""); }}
              >
                <View style={styles.dotPickup} />
                <Text style={[styles.inputRowTxt, !pickup && { color: COLORS.textFaint }]} numberOfLines={1}>
                  {pickup ? pickup.label : "Set pickup"}
                </Text>
              </Pressable>

              <View style={styles.inputDivider} />

              {/* Destination row */}
              <Pressable
                style={[styles.inputRow, activeField === "destination" && styles.inputRowActive]}
                onPress={() => { setActiveField("destination"); setSearchQuery(""); }}
              >
                <Ionicons name="location" size={16} color={COLORS.red} />
                <Text style={[styles.inputRowTxt, !destination && { color: COLORS.textFaint }]} numberOfLines={1}>
                  {destination ? destination.label : "Where to?"}
                </Text>
              </Pressable>
            </View>

            {/* Search field */}
            <View style={styles.searchBar}>
              <Ionicons name="search-outline" size={16} color={COLORS.textFaint} />
              <TextInput
                style={styles.searchInput}
                placeholder={activeField === "pickup" ? "Search pickup..." : "Search destination..."}
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
                    {currentLocation && (
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

            <Pressable onPress={() => setStep("sheet")} style={styles.cancelBtn}>
              <Text style={styles.cancelTxt}>Cancel</Text>
            </Pressable>
          </View>
        )}

        {/* ── TIER SELECTION ── */}
        {(step === "tiers" || step === "requesting") && pickup && destination && (
          <View style={styles.tierPanel}>
            {/* Trip summary */}
            <View style={styles.tripSummaryRow}>
              <View style={styles.dotPickup} />
              <Text style={styles.tripSummaryTxt} numberOfLines={1}>{pickup.label}</Text>
            </View>
            <View style={[styles.tripSummaryRow, { marginTop: 6 }]}>
              <Ionicons name="location" size={14} color={COLORS.red} />
              <Text style={styles.tripSummaryTxt} numberOfLines={1}>{destination.label}</Text>
            </View>
            {estimatedDistance && estimatedDuration ? (
              <Text style={styles.tripMeta}>
                {estimatedDistance.toFixed(1)} km · {Math.round(estimatedDuration)} min · {demandLabel(demandMultiplier)}
              </Text>
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

            <View style={{ marginTop: SPACE.sm, gap: SPACE.sm }}>
              <PrimaryButton
                label={requesting ? "Finding your driver..." : "Request Ride"}
                onPress={handleRequestRide}
                disabled={requesting}
              />
              <Pressable onPress={() => setStep("input_destination")} style={styles.cancelBtn}>
                <Text style={styles.cancelTxt}>Change route</Text>
              </Pressable>
            </View>
          </View>
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
  inputRows: {
    backgroundColor: "rgba(255,255,255,0.04)",
    borderRadius: RADIUS.xl, borderWidth: 1,
    borderColor: "rgba(255,255,255,0.08)", overflow: "hidden",
  },
  inputRow: {
    flexDirection: "row", alignItems: "center",
    gap: SPACE.sm, paddingHorizontal: SPACE.md, paddingVertical: 14,
  },
  inputRowActive: { backgroundColor: "rgba(255,46,46,0.06)" },
  inputRowTxt: { flex: 1, color: COLORS.text, fontSize: 14, fontWeight: "600" },
  inputDivider: { height: 1, backgroundColor: "rgba(255,255,255,0.06)", marginLeft: 46 },
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
  tierPanel: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    padding: SPACE.md, paddingBottom: SPACE.xl,
    maxHeight: "75%",
  },
  tripSummaryRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  tripSummaryTxt: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  tripMeta: { color: COLORS.textFaint, fontSize: 12, marginTop: 4, paddingLeft: 22 },

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