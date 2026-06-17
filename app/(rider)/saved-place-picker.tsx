import React, { useState } from "react";
import { View, Text, StyleSheet, ActivityIndicator } from "react-native";
import { router, useLocalSearchParams } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import MapPicker from "../../src/components/MapPicker";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { reverseGeocode } from "../../src/lib/geocoding";
import { setFixedPlace, addCustomPlace } from "../../src/lib/savedPlaces";

const DEFAULT_CENTER: [number, number] = [28.0473, -26.2041]; // Johannesburg, used until GPS/location is wired in here

export default function SavedPlacePicker() {
  const params = useLocalSearchParams<{ kind: "home" | "work" | "custom" }>();
  const kind = params.kind ?? "custom";

  const [step, setStep] = useState<"map" | "details">("map");
  const [coords, setCoords] = useState<{ latitude: number; longitude: number } | null>(null);
  const [address, setAddress] = useState("");
  const [label, setLabel] = useState(kind === "home" ? "Home" : kind === "work" ? "Work" : "");
  const [geocoding, setGeocoding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleMapConfirm = async (c: { latitude: number; longitude: number }) => {
    setCoords(c);
    setGeocoding(true);
    try {
      const addr = await reverseGeocode(c.latitude, c.longitude);
      setAddress(addr);
    } finally {
      setGeocoding(false);
      setStep("details");
    }
  };

  const handleSave = async () => {
    if (!coords) return;
    if (!label.trim()) {
      setError("Please give this place a name.");
      return;
    }

    setError(null);
    setSaving(true);
    try {
      if (kind === "home" || kind === "work") {
        await setFixedPlace(kind, { label: label.trim(), address, latitude: coords.latitude, longitude: coords.longitude });
      } else {
        await addCustomPlace({ label: label.trim(), address, latitude: coords.latitude, longitude: coords.longitude });
      }
      router.back();
    } catch (e: any) {
      setError(e?.message ?? "Failed to save place.");
    } finally {
      setSaving(false);
    }
  };

  if (step === "map") {
    return (
      <Screen>
        <RiderHeader
          subtitle={`Set ${kind === "custom" ? "Favourite" : kind === "home" ? "Home" : "Work"} Location`}
          menuOpen={false}
          onMenu={() => router.back()}
        />
        <MapPicker initialCenter={DEFAULT_CENTER} onConfirm={handleMapConfirm} />
        {geocoding ? (
          <View style={styles.geocodingOverlay}>
            <ActivityIndicator color={COLORS.red} />
          </View>
        ) : null}
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Confirm Details" menuOpen={false} onMenu={() => setStep("map")} />
      <View style={{ paddingHorizontal: SPACE.md, gap: SPACE.sm }}>
        <GlassCard>
          <Text style={styles.kicker}>ADDRESS</Text>
          <Text style={styles.address}>{address}</Text>
        </GlassCard>

        <TextField
          label="Name this place"
          placeholder={kind === "custom" ? "e.g. Mom's House" : label}
          value={label}
          onChangeText={setLabel}
        />

        <View style={{ marginTop: SPACE.sm }}>
          <PrimaryButton label={saving ? "Saving..." : "Save Place"} onPress={handleSave} disabled={saving} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  geocodingOverlay: {
    position: "absolute",
    top: "50%",
    left: "50%",
    marginLeft: -12,
    marginTop: 40,
  },
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  address: {
    color: COLORS.text,
    fontSize: 14,
    fontWeight: "700",
    marginTop: 6,
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});