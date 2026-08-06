// HMS Map Kit version of RiderMap — renders on Huawei/Honor devices
// without Google Play Services (see src/lib/mobileServices.ts for how
// that's detected). Mirrors RiderMapGoogle.tsx's behavior: center on the
// given coordinate, show the user's live position, and a "center to GPS"
// button.
//
// Requires (once HMS setup is done):
//   npm install @hmscore/react-native-hms-map
// API verified against @hmscore/react-native-hms-map's shipped
// TypeScript defs (HMSMap's `camera` prop takes { target: {latitude,
// longitude}, zoom }, and `setCameraPosition` is available on the ref) —
// not build-tested against real HMS Core hardware.
import React, { useEffect, useRef, useState } from "react";
import { StyleSheet, View, Pressable, Text } from "react-native";
import HMSMap from "@hmscore/react-native-hms-map";
import * as LocationService from "../../lib/locationService";

type Props = {
  centerCoordinate: [number, number]; // [lng, lat]
  zoomLevel?: number;
};

export default function RiderMapHms({ centerCoordinate, zoomLevel = 14 }: Props) {
  const mapRef = useRef<any>(null);
  const [camera, setCamera] = useState({
    target: { latitude: centerCoordinate[1], longitude: centerCoordinate[0] },
    zoom: zoomLevel,
  });
  const [lastUser, setLastUser] = useState<[number, number] | null>(null);

  useEffect(() => {
    setCamera({ target: { latitude: centerCoordinate[1], longitude: centerCoordinate[0] }, zoom: zoomLevel });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [centerCoordinate[0], centerCoordinate[1], zoomLevel]);

  useEffect(() => {
    (async () => {
      try {
        const perm = await LocationService.requestForegroundPermissionsAsync();
        if (perm.status === "granted") {
          const cur = await LocationService.getCurrentPositionAsync({
            accuracy: LocationService.Accuracy.High,
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
    const next = { target: { latitude: lastUser[1], longitude: lastUser[0] }, zoom: Math.max(zoomLevel, 15) };
    setCamera(next);
    mapRef.current?.setCameraPosition?.(next);
  };

  return (
    <View style={styles.root}>
      <HMSMap
        ref={mapRef}
        style={styles.map}
        camera={camera}
        useAnimation
        myLocationEnabled
        myLocationButtonEnabled={false}
        zoomControlsEnabled={false}
        compassEnabled={false}
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
    bottom: 20,
    right: 16,
    backgroundColor: "rgba(0,0,0,0.75)",
    paddingHorizontal: 14,
    paddingVertical: 10,
    borderRadius: 20,
  },
  gpsBtnTxt: { color: "#fff", fontWeight: "700", fontSize: 12 },
});
