import React, { useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import Screen from "../src/components/Screen";
import GlassCard from "../src/components/GlassCard";
import TextField from "../src/components/TextField";
import PrimaryButton from "../src/components/PrimaryButton";
import { COLORS, SPACE } from "../src/theme/tokens";
import { submitDriverRegistration } from "../src/lib/driverApplication";
import { resetTo } from "../src/lib/navigation";

// Reached from the rider side menu's "Become a Driver" banner via
// applyToDrive() — only when the account hasn't provided driver info
// yet. Submitting here immediately flips the account into driver mode
// (see submit_driver_registration in the dual-role migration) and sends
// them straight into document verification, so "Apply" really does kick
// off registration right away rather than just collecting an interest
// form.
export default function DriverRegistrationScreen() {
  const [licenseNumber, setLicenseNumber] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const canSubmit =
    licenseNumber.trim().length > 0 &&
    vehicleMake.trim().length > 0 &&
    vehicleModel.trim().length > 0 &&
    licensePlate.trim().length > 0 &&
    !submitting;

  const handleSubmit = async () => {
    if (!canSubmit) return;
    setSubmitting(true);
    setError(null);
    try {
      await submitDriverRegistration({
        licenseNumber,
        vehicleMake,
        vehicleModel,
        licensePlate,
      });
      // Now registered + switched into driver mode server-side — send
      // them straight to document upload to actually finish onboarding.
      // resetTo (not replace) since this crosses the rider->driver
      // portal boundary and nothing from the rider side, or this form,
      // should stay reachable via back.
      resetTo("/(driver)/verification");
    } catch (e: any) {
      setError(e?.message ?? "Couldn't submit your registration. Please try again.");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Screen>
      <ScrollView
        contentContainerStyle={{ padding: SPACE.md, gap: SPACE.md, paddingBottom: 80 }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.header}>
          <Ionicons name="car-sport-outline" size={28} color={COLORS.red} />
          <Text style={styles.title}>Become a Driver</Text>
          <Text style={styles.subtitle}>
            Tell us about you and your vehicle. You'll upload your documents next —
            this only takes a couple of minutes.
          </Text>
        </View>

        <GlassCard style={{ gap: SPACE.sm }}>
          <Text style={styles.sectionTitle}>Driver Details</Text>
          <TextField
            label="Driver License #"
            placeholder="Enter license number"
            value={licenseNumber}
            onChangeText={setLicenseNumber}
          />
          <TextField
            label="Vehicle Make"
            placeholder="e.g. Toyota"
            value={vehicleMake}
            onChangeText={setVehicleMake}
            autoCapitalize="words"
          />
          <TextField
            label="Vehicle Model"
            placeholder="e.g. Corolla"
            value={vehicleModel}
            onChangeText={setVehicleModel}
            autoCapitalize="words"
          />
          <TextField
            label="License Plate"
            placeholder="e.g. CA 123-456"
            value={licensePlate}
            onChangeText={setLicensePlate}
            autoCapitalize="characters"
          />
        </GlassCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <PrimaryButton
          label={submitting ? "Submitting..." : "Continue to Document Upload"}
          onPress={handleSubmit}
          disabled={!canSubmit}
        />
        {submitting ? (
          <View style={{ alignItems: "center" }}>
            <ActivityIndicator color={COLORS.red} />
          </View>
        ) : null}

        <Text style={styles.footNote}>
          Your rider account stays exactly as it is — you can switch back to riding
          any time from the menu.
        </Text>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  header: { alignItems: "center", gap: 6, paddingVertical: SPACE.sm },
  title: { color: COLORS.text, fontSize: 22, fontWeight: "900" },
  subtitle: { color: COLORS.textDim, fontSize: 13, textAlign: "center", lineHeight: 18, paddingHorizontal: SPACE.sm },
  sectionTitle: { color: COLORS.textFaint, fontSize: 11, letterSpacing: 1.5, textTransform: "uppercase", fontWeight: "800" },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", textAlign: "center" },
  footNote: { color: COLORS.textFaint, fontSize: 12, textAlign: "center", lineHeight: 17, marginTop: SPACE.xs },
});
