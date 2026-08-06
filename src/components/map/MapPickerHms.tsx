// HMS Map Kit version of MapPicker (pickup/destination point picker).
// Same "fixed center pin, drag the map underneath" pattern as
// MapPickerGoogle.tsx.
//
// Requires (once HMS setup is done): npm install @hmscore/react-native-hms-map
// API verified against @hmscore/react-native-hms-map's shipped
// TypeScript defs — not build-tested against real HMS Core hardware.
import React, { useState } from "react";
import { View, Text, Pressable, StyleSheet } from "react-native";
import HMSMap from "@hmscore/react-native-hms-map";
import { Ionicons } from "@expo/vector-icons";
import { COLORS, RADIUS, SPACE } from "../../theme/tokens";

type Props = {
  initialCenter: [number, number]; // [lng, lat]
  onConfirm: (coords: { latitude: number; longitude: number }) => void;
};

export default function MapPickerHms({ initialCenter, onConfirm }: Props) {
  const [center, setCenter] = useState<[number, number]>(initialCenter);

  return (
    <View style={styles.root}>
      <HMSMap
        style={styles.map}
        camera={{ target: { latitude: initialCenter[1], longitude: initialCenter[0] }, zoom: 15 }}
        useAnimation
        onCameraIdle={(e: any) => {
          const target = e?.nativeEvent?.target;
          if (target?.latitude != null && target?.longitude != null) {
            setCenter([target.longitude, target.latitude]);
          }
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
