import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import { COLORS } from "../theme/tokens";
import { useSOSTrigger } from "../hooks/useSOSTrigger";

// Always available (per design), but meant to be placed prominently as a
// floating button on active trip screens.
export default function SOSFab({ rideId, role = "rider" }: { rideId?: string; role?: "rider" | "driver" }) {
  const { presentSOSPrompt, busy } = useSOSTrigger({ rideId, role });

  return (
    <Pressable style={styles.fab} onPress={presentSOSPrompt} disabled={busy}>
      <Ionicons name="alert" size={22} color="#000" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    top: 60,
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: COLORS.red,
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 50,
  },
});