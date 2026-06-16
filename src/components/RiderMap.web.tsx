import React, { useEffect, useMemo, useRef } from "react";
import { StyleSheet, View } from "react-native";
import Map, { Marker } from "react-map-gl/mapbox";

type Props = {
  centerCoordinate: [number, number]; // [lng, lat]
  zoomLevel?: number;
};

const MAPBOX_TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN ?? "";

export default function RiderMap({ centerCoordinate, zoomLevel = 14 }: Props) {
  const mapRef = useRef<any>(null);

  const initialViewState = useMemo(
    () => ({
      longitude: centerCoordinate[0],
      latitude: centerCoordinate[1],
      zoom: zoomLevel,
    }),
    [centerCoordinate[0], centerCoordinate[1], zoomLevel]
  );

  useEffect(() => {
    const map = mapRef.current?.getMap?.();
    if (!map) return;

    map.flyTo({
      center: [centerCoordinate[0], centerCoordinate[1]],
      zoom: zoomLevel,
      duration: 900,
      essential: true,
    });
  }, [centerCoordinate[0], centerCoordinate[1], zoomLevel]);

  return (
    <View style={styles.fill}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={initialViewState}
        mapStyle="mapbox://styles/mapbox/dark-v11"
        attributionControl={false}
        style={styles.fill as any}
      >
        <Marker longitude={centerCoordinate[0]} latitude={centerCoordinate[1]}>
          <div
            style={{
              width: 14,
              height: 14,
              borderRadius: 999,
              transform: "translate(-7px, -7px)",
              background: "rgb(255, 45, 45)",
              boxShadow: "0 0 0 6px rgba(255,45,45,0.22)",
            }}
          />
        </Marker>
      </Map>
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
});
