import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Pressable, Text } from "react-native";
import Mapbox from "@rnmapbox/maps";
import * as Location from "expo-location";

const TOKEN = process.env.EXPO_PUBLIC_MAPBOX_TOKEN as string | undefined;
if (TOKEN) Mapbox.setAccessToken(TOKEN);

try {
  Mapbox.setTelemetryEnabled(false);
} catch {
  // ignore if not available in this SDK version
}

type Props = {
  centerCoordinate: [number, number]; // [lng, lat]
  zoomLevel?: number;
};

export default function RiderMap({ centerCoordinate, zoomLevel = 14 }: Props) {
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [lastUser, setLastUser] = useState<[number, number] | null>(null);

  // Fly to new center when it changes
  useEffect(() => {
    cameraRef.current?.setCamera?.({
      centerCoordinate,
      zoomLevel,
      animationMode: "flyTo",
      animationDuration: 900,
    });
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

        try {
          Mapbox.locationManager.start();
        } catch {
          // not available on this platform/version
        }
      } catch {
        // permission or location services unavailable
      }
    })();

    return () => {
      try {
        Mapbox.locationManager.stop();
      } catch {
        // ignore
      }
    };
  }, []);

  const flyToUser = () => {
    if (!lastUser) return;
    cameraRef.current?.setCamera?.({
      centerCoordinate: lastUser,
      zoomLevel: Math.max(zoomLevel, 15),
      animationMode: "flyTo",
      animationDuration: 700,
    });
  };

  return (
    <View style={styles.root}>
      <Mapbox.MapView
        style={styles.map}
        styleURL="mapbox://styles/thandoluphoko9/cmqn0smkv00b001se3b9gf6g7"
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate,
            zoomLevel,
          }}
        />
      </Mapbox.MapView>

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