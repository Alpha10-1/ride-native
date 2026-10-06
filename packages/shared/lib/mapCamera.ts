import type MapView from "react-native-maps";
import type { RefObject } from "react";

// react-native-maps has no concept of "zoom level" like Mapbox — it uses a
// lat/lng delta region instead. This is a rough approximation (a MapView
// typically shows a few tiles across), good enough to reproduce the same
// framing the app used before; nudge the multiplier if it looks too tight
// or too loose once you can see it on a device.
export function regionFromCenterZoom(lng: number, lat: number, zoomLevel: number) {
  const delta = (360 / Math.pow(2, zoomLevel)) * 3;
  return { latitude: lat, longitude: lng, latitudeDelta: delta, longitudeDelta: delta };
}

// Equivalent of Mapbox Camera.setCamera({ centerCoordinate, zoomLevel, animationMode: "flyTo" }).
export function flyTo(
  ref: RefObject<MapView | null>,
  lng: number,
  lat: number,
  zoomLevel: number,
  durationMs = 700
) {
  ref.current?.animateToRegion(regionFromCenterZoom(lng, lat, zoomLevel), durationMs);
}

// Equivalent of Mapbox Camera.fitBounds(ne, sw, padding, duration) — but
// react-native-maps' fitToCoordinates can take every point on a route (not
// just two corners) and computes the bounding box itself.
export function fitToPoints(
  ref: RefObject<MapView | null>,
  points: [number, number][], // [lng, lat][]
  padding: { top: number; right: number; bottom: number; left: number } = { top: 60, right: 60, bottom: 60, left: 60 }
) {
  if (points.length === 0) return;
  ref.current?.fitToCoordinates(
    points.map(([lng, lat]) => ({ latitude: lat, longitude: lng })),
    { edgePadding: padding, animated: true }
  );
}

// GeoJSON-style [lng, lat] coordinates -> react-native-maps' {latitude, longitude}.
export function toLatLngList(coords: [number, number][]) {
  return coords.map(([lng, lat]) => ({ latitude: lat, longitude: lng }));
}
