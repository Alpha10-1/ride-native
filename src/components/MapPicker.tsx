import React, { useRef, useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import Mapbox from "@rnmapbox/maps";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../theme/tokens";

type Props = {
  initialCenter: [number, number]; // [lng, lat]
  onConfirm: (coords: { latitude: number; longitude: number }) => void;
};

export default function MapPicker({ initialCenter, onConfirm }: Props) {
  const cameraRef = useRef<Mapbox.Camera>(null);
  const [center, setCenter] = useState<[number, number]>(initialCenter);

  return (
    <View style={styles.root}>
      <Mapbox.MapView
        style={styles.map}
        styleURL="mapbox://styles/thandoluphoko9/cmauq6ss2001p01r20y0g444v"
        onCameraChanged={(state: any) => {
          const c = state?.properties?.center;
          if (c) setCenter([c[0], c[1]]);
        }}
      >
        <Mapbox.Camera
          ref={cameraRef}
          defaultSettings={{
            centerCoordinate: initialCenter,
            zoomLevel: 15,
          }}
        />
      </Mapbox.MapView>

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