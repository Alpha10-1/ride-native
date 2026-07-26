import React, { useState } from "react";
import { Pressable, StyleSheet, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";
import * as Location from "expo-location";

import { COLORS } from "../theme/tokens";
import { getEmergencyContacts, triggerSOS, alertEmergencyContact, EMERGENCY_MESSAGE_TEMPLATES } from "../lib/safety";

// Always available (per design), but meant to be placed prominently as a
// floating button on active trip screens.
export default function SOSFab({ rideId, role = "rider" }: { rideId?: string; role?: "rider" | "driver" }) {
  const [busy, setBusy] = useState(false);
  const safetyPath = role === "driver" ? "/(driver)/safety" : "/(rider)/safety";

  const handlePress = () => {
    Alert.alert(
      "Need help?",
      "Alert your emergency contacts now, or open Safety for more options (choosing a message, or picking specific contacts).",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "More Options",
          onPress: () => router.push({ pathname: safetyPath, params: rideId ? { rideId } : {} }),
        },
        { text: "Alert Emergency Contacts", style: "destructive", onPress: handleQuickTrigger },
      ]
    );
  };

  const handleQuickTrigger = async () => {
    setBusy(true);
    try {
      const contacts = await getEmergencyContacts();
      if (contacts.length === 0) {
        Alert.alert(
          "No emergency contacts yet",
          "Add one in Safety settings first so someone can be alerted.",
          [
            { text: "Cancel", style: "cancel" },
            { text: "Add Contact", onPress: () => router.push(safetyPath) },
          ]
        );
        return;
      }

      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") {
        Alert.alert("Location needed", "Location access is needed to share where you are.");
        return;
      }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });

      const defaultMessage = EMERGENCY_MESSAGE_TEMPLATES.find((t) => t.id === "general")!.body;

      await triggerSOS({
        shareScope: "emergency_only",
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        rideId,
        messageTemplate: "general",
        messageBody: defaultMessage,
        contactsNotified: contacts.length,
      });

      for (const c of contacts) {
        await alertEmergencyContact(c.phone, pos.coords.latitude, pos.coords.longitude, defaultMessage);
      }
      Alert.alert("Alert sent", "Your emergency contacts have been notified.");
    } catch (e: any) {
      Alert.alert("Couldn't send alert", e?.message ?? "Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <Pressable style={styles.fab} onPress={handlePress} disabled={busy}>
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