import { useState } from "react";
import { Alert } from "../lib/themedAlert";
import { router } from "expo-router";
import * as Location from "expo-location";

import {
  getEmergencyContacts, triggerSOS, alertEmergencyContact, EMERGENCY_MESSAGE_TEMPLATES,
} from "../lib/safety";

// One shared SOS entry point — used by the floating SOSFab button and by
// the "Safety" shortcut tab on the rider home sheet, so both trigger the
// exact same confirm → alert-contacts flow rather than two copies drifting
// apart over time.
export function useSOSTrigger(params: { rideId?: string; role?: "rider" | "driver" } = {}) {
  const { rideId, role = "rider" } = params;
  const [busy, setBusy] = useState(false);
  const safetyPath = role === "driver" ? "/(driver)/safety" : "/(rider)/safety";

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

  const presentSOSPrompt = () => {
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

  return { presentSOSPrompt, busy };
}