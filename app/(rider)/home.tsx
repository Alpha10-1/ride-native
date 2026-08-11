import React, { useCallback, useEffect, useRef, useState } from "react";
import { View, Text, StyleSheet, Pressable, TextInput, FlatList, ActivityIndicator, ScrollView, Linking, BackHandler } from "react-native";
import { Alert } from "../../src/lib/themedAlert";
import MapView, { PROVIDER_GOOGLE, Marker, Polyline, Region } from "react-native-maps";
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
import SOSFab from "../../src/components/SOSFab";
import { useSOSTrigger } from "../../src/hooks/useSOSTrigger";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getSavedPlaces, SavedPlace } from "../../src/lib/savedPlaces";
import { reverseGeocode, fetchWithTimeout } from "../../src/lib/geocoding";
import { flyTo, fitToPoints, regionFromCenterZoom, toLatLngList } from "../../src/lib/mapCamera";
import {
  getRoute, requestRide, requestScheduledRide, formatFare, demandLabel,
  TIER_CONFIG, RideTier, getActiveRideForRider,
  minRiderOfferCents, proposeRiderFare,
} from "../../src/lib/rides";
import { updateMyLocation } from "../../src/lib/presence";
import { haversineKm } from "../../src/lib/geo";
import {
  PaymentMethod, PAYMENT_METHOD_LABELS,
  getPreferredPaymentMethod, setRidePaymentMethod,
} from "../../src/lib/payments";
import { isWhat3WordsAddress, convertToCoordinates, convertToWords, formatWhat3Words } from "../../src/lib/what3words";

const GOOGLE_MAPS_API_KEY = process.env.EXPO_PUBLIC_GOOGLE_MAPS_API_KEY as string;
if (!GOOGLE_MAPS_API_KEY) {
  console.warn(
    "[rider/home] EXPO_PUBLIC_GOOGLE_MAPS_API_KEY is missing or empty — " +
    "address search and route drawing will silently fail. Check your .env " +
    "file and restart Metro with `npx expo start --dev-client -c` (env " +
    "vars are baked in at bundle time, a plain reload won't pick up changes)."
  );
}
// Distinct from the app's red accent (used for pins/UI) so the route reads
// clearly against the map background instead of blending into it.
const ROUTE_LINE_COLOR = "#3B9EFF";
const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041];

// Once Places API (New) fails once (auth/config issue on the Google Cloud
// side), stop retrying it on every keystroke for the rest of this app
// session — go straight to the Geocoding fallback instead. Avoids spamming
// the console and firing a doomed network request on every character
// typed. Resets on next app launch in case the config gets fixed meanwhile.
let placesApiConfirmedBlocked = false;

type Step = "sheet" | "input_pickup" | "input_destination" | "pin" | "tiers" | "requesting";
type LocationPoint = { label: string; address: string; lat: number; lng: number; what3words?: string };
type SearchResult = { id: string; name: string; address: string; lat: number; lng: number; what3words?: string };

const TIERS: RideTier[] = ["economy", "comfort", "xl"];

export default function RiderHome() {
  const { presentSOSPrompt } = useSOSTrigger({ role: "rider" });
  const [menuOpen, setMenuOpen] = useState(false);
  const mapRef = useRef<MapView>(null);
  const [step, setStep] = useState<Step>("sheet");

  // Location state
  const [currentLocation, setCurrentLocation] = useState<LocationPoint | null>(null);
  const [locatingCurrent, setLocatingCurrent] = useState(false);
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
  // The top live-search match, shown as a distinct pin on the map so the
  // person can see exactly where their search is pointing before confirming.
  const [previewPoint, setPreviewPoint] = useState<{ lat: number; lng: number } | null>(null);
  const [searching, setSearching] = useState(false);

  // Pin state (when user drags map)
  const [pinCoords, setPinCoords] = useState<[number, number] | null>(null);
  const [geocodingPin, setGeocodingPin] = useState(false);
  // Live address preview shown while dragging — resolved for the current
  // pinCoords by the debounced effect below. Kept separate from pinCoords
  // itself so the label can distinguish "still resolving" from "resolved".
  const [pinAddress, setPinAddress] = useState<string | null>(null);

  // Route + fare state
  const [routeGeoJSON, setRouteGeoJSON] = useState<any>(null);
  const [estimatedDistance, setEstimatedDistance] = useState<number | null>(null);
  const [estimatedDuration, setEstimatedDuration] = useState<number | null>(null);
  const [demandMultiplier] = useState(1.1);
  const [selectedTier, setSelectedTier] = useState<RideTier>("economy");
  // Preselected from the rider's saved default; overridable per ride.
  const [paymentMethod, setPaymentMethod] = useState<PaymentMethod>("cash");
  // Optional custom fare offer — set before tapping "Request Ride", so
  // negotiation starts the moment the ride is created rather than
  // requiring a separate step afterward.
  const [showFareNegotiation, setShowFareNegotiation] = useState(false);
  const [customFareInput, setCustomFareInput] = useState("");
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

  // Load GPS + saved places + preferred payment method on mount
  useEffect(() => {
    (async () => {
      try {
        const [places, perm] = await Promise.all([
          getSavedPlaces(),
          Location.requestForegroundPermissionsAsync(),
        ]);
        setSavedPlaces(places);

        try {
          setPaymentMethod(await getPreferredPaymentMethod());
        } catch {
          // non-critical — falls back to "cash"
        }

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
          flyTo(mapRef, pos.coords.longitude, pos.coords.latitude, 14, 800);
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
      type: "LineString",
      coordinates: waypoints.map((w) => [w.lng, w.lat]),
    } as any);
    setRouteRefining(true);

    fitToPoints(mapRef, [[pickup.lng, pickup.lat], [destination.lng, destination.lat]], {
      top: 100, right: 60, bottom: 280, left: 60,
    });

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
          fitToPoints(mapRef, coords, { top: 90, right: 50, bottom: 300, left: 50 });
        }
      } catch {
        // keep the straight-line estimate — still useful, just less precise
      } finally {
        if (!cancelled) setRouteRefining(false);
      }
    })();

    return () => { cancelled = true; };
  }, [pickup, destination, stops]);

  // Live search with debounce. Tries Places Text Search (New) first (handles
  // business/POI names, not just addresses) and automatically falls back to
  // plain Geocoding — which was already confirmed working — if Places (New)
  // errors for any reason. This way address search never regresses to zero
  // results while Places (New) auth gets sorted out on the Google Cloud side.
  useEffect(() => {
    if (!searchQuery.trim() || searchQuery.length < 3) { setSearchResults([]); setPreviewPoint(null); return; }

    const applyResults = (results: SearchResult[]) => {
      setSearchResults(results);
      if (results[0]) {
        setPreviewPoint({ lat: results[0].lat, lng: results[0].lng });
        flyTo(mapRef, results[0].lng, results[0].lat, 14, 400);
      } else {
        setPreviewPoint(null);
      }
    };

    const searchViaGeocoding = async (query: string): Promise<SearchResult[]> => {
      const params = new URLSearchParams({ address: query, region: "za", key: GOOGLE_MAPS_API_KEY });
      const res = await fetchWithTimeout(`https://maps.googleapis.com/maps/api/geocode/json?${params.toString()}`);
      const json = await res.json();
      if (json.status && json.status !== "OK" && json.status !== "ZERO_RESULTS") {
        console.error(
          `[rider/home] Geocoding fallback returned ${json.status}` +
          (json.error_message ? `: ${json.error_message}` : "")
        );
        return [];
      }
      return (json.results ?? [])
        .filter((r: any) => r.geometry?.location)
        .map((r: any) => ({
          id: r.place_id,
          name: (r.formatted_address ?? "").split(",")[0],
          address: r.formatted_address ?? "",
          lat: r.geometry.location.lat,
          lng: r.geometry.location.lng,
        }));
    };

    const t = setTimeout(async () => {
      setSearching(true);

      // A what3words address ("filled.count.soap" or
      // "///filled.count.soap") isn't something Places or Geocoding can
      // resolve — it's exact-but-arbitrary, not a real place name or
      // street address. Detect it and go straight to the What3Words API
      // instead. This is the main way this app supports precise
      // locations in townships/informal settlements that have no
      // reliable street addresses at all.
      if (isWhat3WordsAddress(searchQuery)) {
        try {
          const w3w = await convertToCoordinates(searchQuery);
          applyResults([{
            id: "w3w",
            name: formatWhat3Words(w3w.words),
            address: w3w.nearestPlace ? `Near ${w3w.nearestPlace}` : `${w3w.lat.toFixed(5)}, ${w3w.lng.toFixed(5)}`,
            lat: w3w.lat,
            lng: w3w.lng,
            what3words: w3w.words,
          }]);
        } catch (e: any) {
          // Most commonly: the three words don't form a real w3w address
          // (typo, or just not a what3words combination) — show nothing
          // rather than a scary error; the rider can keep typing or fall
          // back to search/drop-a-pin.
          console.warn("[rider/home] what3words lookup failed:", e?.message ?? e);
          setSearchResults([]);
          setPreviewPoint(null);
        } finally {
          setSearching(false);
        }
        return;
      }

      // Already confirmed blocked this session — skip straight to the
      // fallback instead of firing another doomed request + error log.
      if (placesApiConfirmedBlocked) {
        try {
          applyResults(await searchViaGeocoding(searchQuery));
        } catch (e) {
          console.error("[rider/home] Geocoding request failed:", e);
          setSearchResults([]);
          setPreviewPoint(null);
        } finally {
          setSearching(false);
        }
        return;
      }

      try {
        const bias = pickup ?? currentLocation ?? { lat: DEFAULT_CENTER[1], lng: DEFAULT_CENTER[0] };
        const res = await fetchWithTimeout("https://places.googleapis.com/v1/places:searchText", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Goog-Api-Key": GOOGLE_MAPS_API_KEY,
            "X-Goog-FieldMask": "places.id,places.displayName,places.formattedAddress,places.location",
          },
          body: JSON.stringify({
            textQuery: searchQuery,
            regionCode: "ZA",
            locationBias: {
              circle: {
                center: { latitude: bias.lat, longitude: bias.lng },
                radius: 50000.0, // 50km soft bias, not a hard filter
              },
            },
          }),
        });
        const json = await res.json();

        if (json.error) {
          placesApiConfirmedBlocked = true;
          console.warn(
            `[rider/home] Places Text Search (New) unavailable (${json.error.status ?? res.status}` +
            (json.error.message ? `: ${json.error.message}` : "") +
            ") — using Geocoding for the rest of this session (addresses only, no business names)."
          );
          try {
            const fallbackResults = await searchViaGeocoding(searchQuery);
            applyResults(fallbackResults);
          } catch (fallbackErr) {
            console.error("[rider/home] Geocoding fallback request itself threw:", fallbackErr);
            setSearchResults([]);
            setPreviewPoint(null);
          }
          return;
        }

        const results: SearchResult[] = (json.places ?? [])
          .filter((p: any) => p.location)
          .map((p: any) => ({
            id: p.id,
            name: p.displayName?.text ?? (p.formattedAddress ?? "").split(",")[0],
            address: p.formattedAddress ?? "",
            lat: p.location.latitude,
            lng: p.location.longitude,
          }));
        applyResults(results);
      } catch (e) {
        console.error("[rider/home] Places search request failed, falling back to Geocoding:", e);
        try {
          applyResults(await searchViaGeocoding(searchQuery));
        } catch (e2) {
          console.error("[rider/home] Geocoding fallback also failed:", e2);
          setSearchResults([]);
          setPreviewPoint(null);
        }
      }
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
    setPreviewPoint(null);
    setPinCoords(null);
    setPinAddress(null);
    setShowFareNegotiation(false);
    setCustomFareInput("");
    setError(null);
    setStep("sheet");
  };

  // Hardware back button (Android): step back through the booking flow
  // instead of falling through to the default behavior, which is exiting
  // the app entirely from whatever step the rider happens to be on. Each
  // step's "back" mirrors the on-screen Cancel/Change-route action already
  // available for that step, so behavior stays consistent whichever way the
  // rider backs out. Only "sheet" (the resting/home state, nothing to
  // cancel out of) lets the default back behavior through.
  useFocusEffect(
    useCallback(() => {
      const onBackPress = () => {
        switch (step) {
          case "pin":
            resetBookingFlow();
            return true;
          case "input_pickup":
          case "input_destination":
            if (addingStop) {
              setAddingStop(false);
              setSearchQuery("");
              setSearchResults([]);
              setPreviewPoint(null);
              setStep("tiers");
            } else {
              resetBookingFlow();
            }
            return true;
          case "tiers":
            setStep("input_destination");
            return true;
          case "requesting":
            // A request is in flight — don't let back interrupt it.
            return true;
          case "sheet":
          default:
            return false;
        }
      };
      const sub = BackHandler.addEventListener("hardwareBackPress", onBackPress);
      return () => sub.remove();
    }, [step, addingStop])
  );

  const confirmSearchResult = (result: SearchResult) => {
    const point: LocationPoint = {
      label: result.name, address: result.address, lat: result.lat, lng: result.lng,
      what3words: result.what3words,
    };
    if (addingStop) {
      setStops((prev) => [...prev, point]);
      setAddingStop(false);
      setStep("tiers");
    } else if (activeField === "pickup") { setPickup(point); setStep("tiers"); }
    else { setDestination(point); setSearchQuery(""); setSearchResults([]); if (pickup) setStep("tiers"); else { setStep("input_pickup"); setActiveField("pickup"); } }
    setSearchQuery("");
    setSearchResults([]);
    setPreviewPoint(null);
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
  // "Current location" previously only ever came from the one silent GPS
  // read on mount — if permission was denied then (or granted afterwards
  // via Settings, or the read simply timed out), the option just quietly
  // never appeared again with no way to retry short of restarting the
  // app. This makes it available on demand instead: reuse the cached fix
  // if we already have one, otherwise actually (re)request permission and
  // fetch a fresh position right when the rider taps it.
  const useCurrentLocationNow = async () => {
    if (currentLocation) {
      confirmSearchResult({
        id: "cur", name: "Current location",
        address: currentLocation.address, lat: currentLocation.lat, lng: currentLocation.lng,
      });
      return;
    }
    setLocatingCurrent(true);
    try {
      let perm = await Location.getForegroundPermissionsAsync();
      if (perm.status !== "granted") {
        perm = await Location.requestForegroundPermissionsAsync();
      }
      if (perm.status !== "granted") {
        Alert.alert(
          "Location access needed",
          "RIDE needs location access to find your current spot. You can enable it in your phone's Settings.",
          [
            { text: "Not now", style: "cancel" },
            { text: "Open Settings", onPress: () => Linking.openSettings().catch(() => {}) },
          ]
        );
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      const addr = await reverseGeocode(pos.coords.latitude, pos.coords.longitude);
      const loc: LocationPoint = {
        label: "Current location", address: addr,
        lat: pos.coords.latitude, lng: pos.coords.longitude,
      };
      setCurrentLocation(loc);
      confirmSearchResult({ id: "cur", name: "Current location", address: addr, lat: loc.lat, lng: loc.lng });
    } catch (e: any) {
      Alert.alert("Couldn't get your location", e?.message ?? "Please try again, or drop a pin on the map instead.");
    } finally {
      setLocatingCurrent(false);
    }
  };

  const startPinMode = (field: "pickup" | "destination") => {
    setActiveField(field);
    setStep("pin");
    // Bug: pinCoords previously only got set inside onRegionChangeComplete,
    // which only fires once the user actually pans the map. If the pin
    // (fixed at screen center) already sits over the right spot when this
    // opens, "Confirm Pin" stayed disabled with nothing visibly wrong —
    // it looked placed, it just couldn't be confirmed. Read the map's
    // current center immediately instead of waiting for a drag.
    setPinCoords(null);
    setPinAddress(null);
    mapRef.current?.getCamera()
      .then((camera) => {
        if (camera?.center) {
          setPinCoords([camera.center.longitude, camera.center.latitude]);
        }
      })
      .catch(() => {
        // onRegionChangeComplete still covers this once they drag.
      });
  };

  // Live address preview while dragging the pin. Debounced so a fast drag
  // doesn't fire a geocode request per frame — only once the map settles
  // (matches onRegionChangeComplete's own "drag finished" cadence) plus a
  // short buffer. `cancelled` guards against a slow, stale request from an
  // earlier position landing after the user has already moved on.
  useEffect(() => {
    if (step !== "pin" || !pinCoords) return;
    setPinAddress(null);
    let cancelled = false;
    const timer = setTimeout(() => {
      reverseGeocode(pinCoords[1], pinCoords[0]).then((addr) => {
        if (!cancelled) setPinAddress(addr);
      });
    }, 350);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pinCoords, step]);

  const confirmPin = async () => {
    if (!pinCoords) return;
    setGeocodingPin(true);
    try {
      // Reuse the address the live preview already resolved for this exact
      // pinCoords, if it's ready — avoids a redundant geocode call for the
      // common case where the user waited to see the address before
      // confirming. Falls back to a fresh lookup if they tapped Confirm
      // before the debounce settled.
      const [addr, w3w] = await Promise.all([
        pinAddress ? Promise.resolve(pinAddress) : reverseGeocode(pinCoords[1], pinCoords[0]),
        // Best-effort — reverse-geocoding already has its own coordinate
        // fallback, so a failed w3w lookup here just means the point
        // ships without a what3words tag, not a broken flow. This is
        // often the most useful part of a pin drop in an area with no
        // real street address: reverseGeocode may only return raw
        // coordinates, but the what3words tag is still short, exact, and
        // shareable.
        convertToWords(pinCoords[1], pinCoords[0]).catch(() => null),
      ]);
      // w3w is best-effort (see convertToWords) and its shape isn't
      // guaranteed — guard on w3w.words specifically, not just w3w, so a
      // malformed/partial response can't throw here and get silently
      // swallowed by the catch below (which used to abort the whole
      // confirm with no visible error — this is what was actually causing
      // "Confirming..." to bounce back to "Confirm Pin" with nothing
      // happening beyond that).
      const point: LocationPoint = {
        label: w3w?.words ? formatWhat3Words(w3w.words) : "Pinned location",
        address: addr,
        lat: pinCoords[1],
        lng: pinCoords[0],
        what3words: w3w?.words,
      };
      if (addingStop) {
        setStops((prev) => [...prev, point]);
        setAddingStop(false);
        setStep("tiers");
      } else if (activeField === "pickup") {
        setPickup(point);
        setStep("tiers"); // destination is always already set by the time pickup is being pinned
      } else {
        setDestination(point);
        if (pickup) setStep("tiers");
        else { setStep("input_pickup"); setActiveField("pickup"); }
      }
    } catch (err: any) {
      console.error("confirmPin failed:", err);
      Alert.alert("Couldn't confirm location", err?.message ?? "Please try again.");
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
    let customFareCents: number | null = null;
    if (showFareNegotiation && !scheduling) {
      const parsed = Math.round(parseFloat(customFareInput) * 100);
      if (isNaN(parsed) || parsed <= 0) {
        Alert.alert("Enter an amount", "Please enter a valid fare offer, or tap the X to cancel it.");
        return;
      }
      const min = minRiderOfferCents(tierFare(selectedTier));
      if (parsed < min) {
        Alert.alert("Offer too low", `Your offer can't be less than ${formatFare(min)} (50% of the estimated fare).`);
        return;
      }
      customFareCents = parsed;
    }
    setError(null);
    setStep("requesting");
    setRequesting(true);
    try {
      // request_ride (and the rides table) has no dedicated what3words
      // column — folding the tag into the address string is the
      // simplest way to get it to persist and show up everywhere
      // downstream (driver's active-trip screen, trip slip, chat)
      // without a schema/RPC change. Put first, not appended: several
      // screens truncate this string to one line, and the what3words
      // tag is the part that matters most in an area with no real
      // street address — it shouldn't be the part that gets cut off.
      const addressWithW3W = (point: LocationPoint) =>
        point.what3words ? `${formatWhat3Words(point.what3words)} · ${point.address}` : point.address;

      const commonParams = {
        pickupLabel: pickup.label,
        pickupAddress: addressWithW3W(pickup),
        pickupLat: pickup.lat,
        pickupLng: pickup.lng,
        destinationLabel: destination.label,
        destinationAddress: addressWithW3W(destination),
        destinationLat: destination.lat,
        destinationLng: destination.lng,
        estimatedDistanceKm: estimatedDistance,
        estimatedDurationMin: estimatedDuration,
        rideTier: selectedTier,
        stops: stops.map((s) => ({ label: s.label, address: addressWithW3W(s), lat: s.lat, lng: s.lng })),
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

      // The ride already defaults to the rider's saved payment
      // preference server-side (via a DB trigger). This only needs to
      // run when they picked something different just for this trip —
      // but since a driver can accept (and, for card rides, trigger a
      // fund reservation) at any moment after this, it retries once
      // instead of silently giving up, so the ride doesn't end up
      // charged against the wrong method.
      if (paymentMethod !== ride.payment_method) {
        try {
          await setRidePaymentMethod(ride.id, paymentMethod);
        } catch (e: any) {
          console.warn("[rider/home] Couldn't set ride payment method, retrying once:", e?.message ?? e);
          try {
            await setRidePaymentMethod(ride.id, paymentMethod);
          } catch (e2: any) {
            console.warn("[rider/home] Retry also failed, ride will use the saved default:", e2?.message ?? e2);
          }
        }
      }

      // If a custom fare was set before requesting, send it the moment the
      // ride exists — best-effort: if this fails, the rider can still
      // propose a fare from the tracking screen, so it shouldn't block
      // getting there.
      if (customFareCents) {
        try {
          await proposeRiderFare(ride.id, customFareCents);
        } catch (e: any) {
          console.warn("[rider/home] Couldn't set initial fare offer:", e?.message ?? e);
        }
      }

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

  const work = savedPlaces.find((p) => p.kind === "work");
  const customs = savedPlaces.filter((p) => p.kind === "custom");

  return (
    <Screen>
      <RiderHeader subtitle="Where to?" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <SOSFab role="rider" />

      <View style={styles.root}>
        {/* ── MAP ── */}
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={StyleSheet.absoluteFill}
          initialRegion={regionFromCenterZoom(DEFAULT_CENTER[0], DEFAULT_CENTER[1], 13)}
          onRegionChangeComplete={(region: Region) => {
            if (step === "pin") {
              setPinCoords([region.longitude, region.latitude]);
            }
          }}
        >
          {/* Pickup marker */}
          {pickup && step !== "pin" && (
            <Marker coordinate={{ latitude: pickup.lat, longitude: pickup.lng }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.markerPickup}>
                <Ionicons name="ellipse" size={10} color="#000" />
              </View>
            </Marker>
          )}

          {/* Stop markers */}
          {step !== "pin" && stops.map((stop, i) => (
            <Marker key={i} coordinate={{ latitude: stop.lat, longitude: stop.lng }} anchor={{ x: 0.5, y: 0.5 }}>
              <View style={styles.markerStop}>
                <Text style={styles.markerStopTxt}>{i + 1}</Text>
              </View>
            </Marker>
          ))}

          {/* Destination marker */}
          {destination && step !== "pin" && (
            <Marker coordinate={{ latitude: destination.lat, longitude: destination.lng }} anchor={{ x: 0.5, y: 1 }}>
              <View style={styles.markerDest}>
                <Ionicons name="location" size={28} color={COLORS.red} />
              </View>
            </Marker>
          )}

          {/* Live-search preview — the top match, shown distinctly from a
              confirmed pickup/destination pin so it's clear this is just a
              preview until the person actually taps a suggestion. */}
          {previewPoint && (step === "input_pickup" || step === "input_destination") && (
            <Marker
              coordinate={{ latitude: previewPoint.lat, longitude: previewPoint.lng }}
              anchor={{ x: 0.5, y: 1 }}
            >
              <View style={styles.markerPreview}>
                <Ionicons name="location" size={26} color="#3B9EFF" />
              </View>
            </Marker>
          )}

          {/* Route line — dark casing underneath for contrast on any map
              background, colored line on top. Two overlapping Polylines
              since react-native-maps has no single "line + casing" style. */}
          {routeGeoJSON?.coordinates && (
            <>
              <Polyline
                coordinates={toLatLngList(routeGeoJSON.coordinates)}
                strokeColor="#0a0a0a"
                strokeWidth={8}
                lineCap="round"
                lineJoin="round"
              />
              <Polyline
                coordinates={toLatLngList(routeGeoJSON.coordinates)}
                strokeColor={ROUTE_LINE_COLOR}
                strokeWidth={5}
                lineCap="round"
                lineJoin="round"
              />
            </>
          )}
        </MapView>

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
            <Text style={styles.pinInstruction} numberOfLines={2}>
              {pinAddress
                ? pinAddress
                : pinCoords
                ? `${pinCoords[1].toFixed(5)}, ${pinCoords[0].toFixed(5)}`
                : "Drag map to position pin"}
            </Text>
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
              else if (tab === "safety") presentSOSPrompt();
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
              {(work || customs.length > 0) && (
                <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ marginHorizontal: -4 }}>
                  <View style={styles.quickRow}>
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
        {/* Draggable so it can be collapsed down to peek at the map while
            searching — scrollable=false since the suggestions FlatList
            below already handles its own scrolling. */}
        {(step === "input_pickup" || step === "input_destination") && (
          <DraggableSheet topGap={140} peekHeight={130} defaultExpanded scrollable={false}>
            {/* No flex:1 here — DraggableSheet now sizes itself to this
                content's natural height (measured via onLayout) rather than
                always filling the screen, so this must size to content too,
                not stretch to fill whatever height the sheet happens to be. */}
            <View style={{ gap: SPACE.sm }}>
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
                placeholder={step === "input_pickup" ? "Search pickup or ///what3words..." : addingStop ? "Search stop or ///what3words..." : "Search destination or ///what3words..."}
                placeholderTextColor={COLORS.textFaint}
                value={searchQuery}
                onChangeText={setSearchQuery}
                autoFocus
              />
              {searching && <ActivityIndicator size="small" color={COLORS.red} />}
            </View>
            {searchQuery.length < 3 && (
              <Text style={styles.w3wHint}>
                No street address nearby? Try a what3words address, e.g. ///filled.count.soap
              </Text>
            )}

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
                    {step === "input_pickup" && (
                      <Pressable
                        style={styles.suggestion}
                        disabled={locatingCurrent}
                        onPress={useCurrentLocationNow}
                      >
                        {locatingCurrent ? (
                          <ActivityIndicator size="small" color={COLORS.red} />
                        ) : (
                          <Ionicons name="navigate-outline" size={16} color={COLORS.red} />
                        )}
                        <View style={{ flex: 1 }}>
                          <Text style={styles.suggestionName}>Current location</Text>
                          <Text style={styles.suggestionAddr} numberOfLines={1}>
                            {locatingCurrent ? "Locating..." : currentLocation?.address ?? "Tap to use your GPS location"}
                          </Text>
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
                  <Ionicons name={item.what3words ? "grid-outline" : "location-outline"} size={16} color={COLORS.red} />
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
                  setPreviewPoint(null);
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
          </DraggableSheet>
        )}

        {/* ── TIER SELECTION ── */}
        {(step === "tiers" || step === "requesting") && pickup && destination && (
          <DraggableSheet topGap={140} peekHeight={110}>
            {/* Trip summary */}
            <View style={styles.tripSummaryRow}>
              <View style={styles.dotPickup} />
              <View style={{ flex: 1 }}>
                <Text style={styles.tripSummaryTxt} numberOfLines={1}>{pickup.label}</Text>
                {pickup.what3words && (
                  <Text style={styles.tripSummarySub} numberOfLines={1}>{pickup.address}</Text>
                )}
              </View>
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
              <View style={{ flex: 1 }}>
                <Text style={styles.tripSummaryTxt} numberOfLines={1}>{destination.label}</Text>
                {destination.what3words && (
                  <Text style={styles.tripSummarySub} numberOfLines={1}>{destination.address}</Text>
                )}
              </View>
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

            {/* Payment method — defaults to the rider's saved preference,
                overridable per ride. Shown before Request Ride so the
                choice is made (or confirmed) before the ride is sent to
                drivers, not after. */}
            <Text style={styles.paymentLabel}>Payment method</Text>
            <View style={styles.paymentRow}>
              {(["cash", "wallet", "card"] as PaymentMethod[]).map((method) => {
                const isSelected = paymentMethod === method;
                return (
                  <Pressable
                    key={method}
                    style={[styles.paymentChip, isSelected && styles.paymentChipSelected]}
                    onPress={() => setPaymentMethod(method)}
                  >
                    <Ionicons
                      name={method === "cash" ? "cash-outline" : method === "wallet" ? "wallet-outline" : "card-outline"}
                      size={14}
                      color={isSelected ? "#000" : COLORS.textDim}
                    />
                    <Text style={[styles.paymentChipTxt, isSelected && styles.paymentChipTxtSelected]}>
                      {PAYMENT_METHOD_LABELS[method]}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {error ? <Text style={styles.error}>{error}</Text> : null}

            {/* Propose a fare — before requesting. Hidden while scheduling
                for later, since negotiation only applies to immediate
                requests (a scheduled ride isn't broadcast to drivers yet). */}
            {!scheduling && (
              <View style={{ gap: 8 }}>
                {showFareNegotiation ? (
                  <View style={styles.offerInputRow}>
                    <TextInput
                      value={customFareInput}
                      onChangeText={setCustomFareInput}
                      placeholder={`Your price (min ${formatFare(minRiderOfferCents(tierFare(selectedTier)))})`}
                      placeholderTextColor={COLORS.textFaint}
                      keyboardType="decimal-pad"
                      style={styles.offerInput}
                      autoFocus
                    />
                    <Pressable
                      style={styles.cancelBtn}
                      onPress={() => { setShowFareNegotiation(false); setCustomFareInput(""); }}
                    >
                      <Ionicons name="close" size={18} color={COLORS.textFaint} />
                    </Pressable>
                  </View>
                ) : (
                  <Pressable onPress={() => setShowFareNegotiation(true)}>
                    <Text style={styles.makeOfferLink}>Propose a different fare</Text>
                  </Pressable>
                )}
              </View>
            )}

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
                  setShowFareNegotiation(false);
                  setCustomFareInput("");
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
  markerPreview: { alignItems: "center", opacity: 0.9 },
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
  // elevation+zIndex are required on Android: MapView renders as a native
  // SurfaceView, which can swallow touches meant for RN siblings on top of
  // it unless those siblings are explicitly elevated above it. Every other
  // control overlaid on a MapView in this app (ride-tracking.tsx,
  // active-trip.tsx, driver home.tsx) already sets this — this was the one
  // overlay missing it, which is why "Confirm Pin" rendered fine but never
  // responded to taps on physical Android devices.
  pinConfirmWrap: {
    position: "absolute", bottom: 0, left: 0, right: 0,
    backgroundColor: "#070707",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)",
    padding: SPACE.md, paddingBottom: SPACE.xl, gap: SPACE.sm,
    elevation: 6,
    zIndex: 50,
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
  offerInputRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  offerInput: {
    flex: 1, backgroundColor: "rgba(0,0,0,0.65)", borderRadius: RADIUS.lg,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.05)",
    paddingHorizontal: 14, paddingVertical: 10,
    color: COLORS.text, fontSize: 14,
  },
  makeOfferLink: { color: COLORS.red, fontWeight: "800", fontSize: 13, textAlign: "center" },
  paymentLabel: { color: COLORS.textDim, fontSize: 12, fontWeight: "700", marginTop: SPACE.sm },
  paymentRow: { flexDirection: "row", gap: 8, marginTop: 6 },
  paymentChip: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    paddingVertical: 10,
    borderRadius: RADIUS.pill,
    borderWidth: 1,
    borderColor: "rgba(255,255,255,0.1)",
    backgroundColor: "rgba(255,255,255,0.03)",
  },
  paymentChipSelected: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  paymentChipTxt: { color: COLORS.textDim, fontWeight: "800", fontSize: 12 },
  paymentChipTxtSelected: { color: "#000" },
  cancelTxt: { color: COLORS.red, fontWeight: "700", fontSize: 14 },

  // Tier panel
  tripSummaryRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  tripSummaryTxt: { flex: 1, color: COLORS.textDim, fontSize: 13 },
  tripSummarySub: { color: COLORS.textFaint, fontSize: 11, marginTop: 1 },
  w3wHint: { color: COLORS.textFaint, fontSize: 11, paddingHorizontal: 2, marginTop: -4 },
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