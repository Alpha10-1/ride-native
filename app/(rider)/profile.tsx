import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import TextField from "../../src/components/TextField";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { getCurrentProfile, updateProfile } from "../../src/lib/auth";

export default function RiderProfile() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cellphone, setCellphone] = useState("");

  // driver-only
  const [driverLicenseNumber, setDriverLicenseNumber] = useState("");
  const [vehicleMake, setVehicleMake] = useState("");
  const [vehicleModel, setVehicleModel] = useState("");
  const [licensePlate, setLicensePlate] = useState("");

  useEffect(() => {
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          router.replace("/auth/login");
          return;
        }
        setUsername(profile.username);
        setRole(profile.role);
        setFirstName(profile.first_name);
        setLastName(profile.last_name);
        setEmail(profile.email);
        setCellphone(profile.cellphone);
        setDriverLicenseNumber(profile.driver_license_number ?? "");
        setVehicleMake(profile.vehicle_make ?? "");
        setVehicleModel(profile.vehicle_model ?? "");
        setLicensePlate(profile.license_plate ?? "");
      } catch (e: any) {
        setError(e?.message ?? "Failed to load profile.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleSave = async () => {
    setError(null);
    setSuccess(false);
    if (!firstName.trim() || !lastName.trim() || !email.trim() || !cellphone.trim()) {
      setError("Please fill in all required fields.");
      return;
    }

    setSaving(true);
    try {
      await updateProfile({
        firstName,
        lastName,
        email,
        cellphone,
        ...(role === "driver"
          ? { driverLicenseNumber, vehicleMake, vehicleModel, licensePlate }
          : {}),
      });
      setSuccess(true);
    } catch (e: any) {
      setError(e?.message ?? "Failed to save changes.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Profile" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Profile" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <GlassCard>
          <Text style={styles.kicker}>@{username}</Text>
          <Text style={styles.sub}>
            {role === "driver" ? "Driver account" : "Rider account"}
          </Text>
        </GlassCard>

        <View style={{ gap: SPACE.sm, marginTop: SPACE.sm }}>
          <TextField label="First Name" placeholder="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
          <TextField label="Last Name" placeholder="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
          <TextField label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <TextField label="Cellphone" placeholder="082 123 4567" value={cellphone} onChangeText={setCellphone} keyboardType="phone-pad" />

          {role === "driver" && (
            <>
              <Text style={styles.section}>Driver Details</Text>
              <TextField label="Driver License #" placeholder="Enter license number" value={driverLicenseNumber} onChangeText={setDriverLicenseNumber} />
              <TextField label="Vehicle Make" placeholder="e.g. Toyota" value={vehicleMake} onChangeText={setVehicleMake} autoCapitalize="words" />
              <TextField label="Vehicle Model" placeholder="e.g. Corolla" value={vehicleModel} onChangeText={setVehicleModel} autoCapitalize="words" />
              <TextField label="License Plate" placeholder="e.g. CA 123-456" value={licensePlate} onChangeText={setLicensePlate} autoCapitalize="characters" />
            </>
          )}
        </View>

        <View style={{ marginTop: SPACE.md }}>
          <PrimaryButton label={saving ? "Saving..." : "Save Changes"} onPress={handleSave} disabled={saving} />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}
        {success ? <Text style={styles.success}>Profile updated.</Text> : null}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  kicker: {
    color: COLORS.text,
    fontSize: 16,
    fontWeight: "900",
  },
  sub: { color: COLORS.textDim, marginTop: 6, fontSize: 13 },
  section: {
    marginTop: SPACE.md,
    marginBottom: 6,
    paddingLeft: 4,
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
  success: {
    color: "rgba(120,220,150,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});