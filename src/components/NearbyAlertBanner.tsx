import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";

import { COLORS, RADIUS } from "../theme/tokens";
import { getNearbyPublicAlerts, SOSAlert } from "../lib/safety";

// Polls once on mount for nearby public SOS alerts (people who explicitly
// chose to share with nearby app users, not just their emergency contacts).
// Silent on any failure — this is a nice-to-have, not core trip flow.
export default function NearbyAlertBanner() {
  const [alerts, setAlerts] = useState<SOSAlert[]>([]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { status } = await Location.getForegroundPermissionsAsync();
        if (status !== "granted") return;
        const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low });
        const nearby = await getNearbyPublicAlerts(pos.coords.latitude, pos.coords.longitude, 3);
        if (!cancelled) setAlerts(nearby);
      } catch {
        // silent — this is best-effort
      }
    })();
    return () => { cancelled = true; };
  }, []);

  if (alerts.length === 0) return null;

  return (
    <Pressable
      style={styles.banner}
      onPress={() =>
        Alert.alert(
          "Nearby SOS Alert",
          `${alerts.length} ${alerts.length === 1 ? "person" : "people"} within 3km shared a safety alert with nearby app users. If you're able to help or check in safely, consider doing so — or contact local emergency services if it looks serious.`
        )
      }
    >
      <Ionicons name="alert-circle" size={16} color={COLORS.red} />
      <Text style={styles.text}>
        {alerts.length} nearby SOS alert{alerts.length > 1 ? "s" : ""} — tap for details
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: "row", alignItems: "center", gap: 8,
    backgroundColor: "rgba(255,46,46,0.12)",
    borderWidth: 1, borderColor: COLORS.borderRed,
    borderRadius: RADIUS.md, paddingHorizontal: 12, paddingVertical: 10,
  },
  text: { color: COLORS.red, fontWeight: "800", fontSize: 12, flex: 1 },
});