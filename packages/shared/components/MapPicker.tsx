import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import MapView, { PROVIDER_GOOGLE, Region } from "react-native-maps";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";
import { regionFromCenterZoom } from "../lib/mapCamera";

type Props = {
  initialCenter: [number, number]; // [lng, lat]
  onConfirm: (coords: { latitude: number; longitude: number }) => void;
};

export default function MapPicker({ initialCenter, onConfirm }: Props) {
  const mapRef = useRef<MapView>(null);
  const [center, setCenter] = useState<[number, number]>(initialCenter);

  return (
    <View style={styles.root}>
      <MapView
        ref={mapRef}
        provider={PROVIDER_GOOGLE}
        style={styles.map}
        initialRegion={regionFromCenterZoom(initialCenter[0], initialCenter[1], 15)}
        onRegionChangeComplete={(region: Region) => {
          setCenter([region.longitude, region.latitude]);
        }}
      />

      {/* Fixed center pin, overlaid on top of the map (doesn't move with the map) */}
      <View style={styles.pinWrap} pointerEvents="none">
        <Ionicons name="location" size={36} color={COLORS.red} />
      </View>

      <View style={styles.confirmWrap}>
        <Pressable
          style={styles.confirmBtn}
          onPress={() => onConfirm({ latitude: center[1], longitude: center[0] })}
        >
          <Text style={styles.confirmTxt}>Confirm Location</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  map: { flex: 1 },
  pinWrap: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -18,
    marginTop: -36,
  },
  confirmWrap: {
    position: "absolute",
    bottom: 24,
    left: SPACE.md,
    right: SPACE.md,
  },
  confirmBtn: {
    height: 52,
    borderRadius: RADIUS.xl,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
  },
  confirmTxt: {
    color: "#000",
    fontWeight: "900",
    fontSize: 16,
  },
});
