import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Pressable, Text } from "react-native";
import MapView, { PROVIDER_GOOGLE } from "react-native-maps";
import * as Location from "expo-location";
import { flyTo, regionFromCenterZoom } from "../../lib/mapCamera";

type Props = {
  centerCoordinate: [number, number]; // [lng, lat]
  zoomLevel?: number;
};

export default function RiderMap({ centerCoordinate, zoomLevel = 14 }: Props) {
  const mapRef = useRef<MapView>(null);
  const [lastUser, setLastUser] = useState<[number, number] | null>(null);

  // Fly to new center when it changes
  useEffect(() => {
    flyTo(mapRef, centerCoordinate[0], centerCoordinate[1], zoomLevel, 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerCoordinate[0], centerCoordinate[1], zoomLevel]);

  // Request location permission and get current position
  useEffect(() => {
    (async () => {
      try {
        const perm = await Location.requestForegroundPermissionsAsync();
        if (perm.status === "granted") {
          const cur = await Location.getCurrentPositionAsync({
            accuracy: Location.Accuracy.High,
          });
          setLastUser([cur.coords.longitude, cur.coords.latitude]);
        }
      } catch {
        // permission or location services unavailable
      }
    })();
  }, []);

  const flyToUser = () => {
    if (!lastUser) return;
    flyTo(mapRef, lastUser[0], lastUser[1], Math.max(zoomLevel, 15), 700);
  };

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={regionFromCenterZoom(centerCoordinate[0], centerCoordinate[1], zoomLevel)}
        showsUserLocation
      />

      <Pressable style={styles.gpsBtn} onPress={flyToUser}>
        <Text style={styles.gpsBtnTxt}>Center to GPS</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  gpsBtn: {
    position: "absolute",
    bottom: 24,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 12,
  },
  gpsBtnTxt: { color: "white", fontWeight: "700" },
});
