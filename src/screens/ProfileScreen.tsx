import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import SideMenuDrawer from "../components/SideMenuDrawer";
import GlassCard from "../components/GlassCard";
import TextField from "../components/TextField";
import PrimaryButton from "../components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../theme/tokens";
import { getCurrentProfile, updateProfile } from "../lib/auth";
import { getProfileStats, formatFare, ProfileStats } from "../lib/rides";
import { getMyVerificationStatus, VerificationStatus } from "../lib/verification";

const VERIFICATION_META: Record<VerificationStatus, { label: string; color: string }> = {
  unverified: { label: "Not started", color: COLORS.textDim },
  pending: { label: "Under review", color: "#ffb020" },
  verified: { label: "Verified", color: "rgba(120,220,150,0.95)" },
  rejected: { label: "Action needed", color: COLORS.red },
};

export default function ProfileScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [username, setUsername] = useState("");
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [createdAt, setCreatedAt] = useState<string | null>(null);
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [cellphone, setCellphone] = useState("");

  const [stats, setStats] = useState<ProfileStats>({ tripCount: 0, totalCents: 0 });
  const [verification, setVerification] = useState<VerificationStatus>("unverified");

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
        setCreatedAt(profile.created_at ?? null);
        setFirstName(profile.first_name);
        setLastName(profile.last_name);
        setEmail(profile.email);
        setCellphone(profile.cellphone);
        setDriverLicenseNumber(profile.driver_license_number ?? "");
        setVehicleMake(profile.vehicle_make ?? "");
        setVehicleModel(profile.vehicle_model ?? "");
        setLicensePlate(profile.license_plate ?? "");

        getProfileStats().then(setStats).catch(() => {});
        if (profile.role === "driver") {
          getMyVerificationStatus().then((v) => setVerification(v.status)).catch(() => {});
        }
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

  const initials = `${firstName?.[0] ?? ""}${lastName?.[0] ?? ""}`.toUpperCase() || "?";
  const memberSince = createdAt
    ? new Date(createdAt).toLocaleDateString("en-ZA", { month: "long", year: "numeric" })
    : null;
  const vMeta = VERIFICATION_META[verification];

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
        {/* Identity header */}
        <GlassCard style={styles.identityCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarTxt}>{initials}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.nameTxt}>{firstName} {lastName}</Text>
            <Text style={styles.usernameTxt}>@{username}</Text>
            <View style={styles.roleRow}>
              <View style={styles.roleBadge}>
                <Ionicons name={role === "driver" ? "car-sport-outline" : "person-outline"} size={12} color={COLORS.red} />
                <Text style={styles.roleBadgeTxt}>{role === "driver" ? "Driver" : "Rider"}</Text>
              </View>
              {memberSince && <Text style={styles.memberSince}>Member since {memberSince}</Text>}
            </View>
          </View>
        </GlassCard>

        {/* Stats */}
        <GlassCard style={styles.statsCard}>
          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>Total Trips</Text>
              <Text style={styles.statValue}>{stats.tripCount}</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statLabel}>{role === "driver" ? "Total Earned" : "Total Spent"}</Text>
              <Text style={styles.statValue}>{formatFare(stats.totalCents)}</Text>
            </View>
          </View>

          {role === "driver" && (
            <View style={styles.verificationRow}>
              <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
                <View style={[styles.verificationDot, { backgroundColor: vMeta.color }]} />
                <Text style={[styles.verificationTxt, { color: vMeta.color }]}>
                  Verification: {vMeta.label}
                </Text>
              </View>
              <Text style={styles.verificationLink} onPress={() => router.push("/(driver)/verification")}>
                {verification === "verified" ? "View" : "Complete"}
              </Text>
            </View>
          )}
        </GlassCard>

        {/* Personal information */}
        <Text style={styles.section}>Personal Information</Text>
        <GlassCard style={{ gap: SPACE.sm }}>
          <TextField label="First Name" placeholder="First name" value={firstName} onChangeText={setFirstName} autoCapitalize="words" />
          <TextField label="Last Name" placeholder="Last name" value={lastName} onChangeText={setLastName} autoCapitalize="words" />
          <TextField label="Email" placeholder="you@example.com" value={email} onChangeText={setEmail} keyboardType="email-address" />
          <TextField label="Cellphone" placeholder="082 123 4567" value={cellphone} onChangeText={setCellphone} keyboardType="phone-pad" />
        </GlassCard>

        {role === "driver" && (
          <>
            <Text style={styles.section}>Vehicle & License Details</Text>
            <GlassCard style={{ gap: SPACE.sm }}>
              <TextField label="Driver License #" placeholder="Enter license number" value={driverLicenseNumber} onChangeText={setDriverLicenseNumber} />
              <TextField label="Vehicle Make" placeholder="e.g. Toyota" value={vehicleMake} onChangeText={setVehicleMake} autoCapitalize="words" />
              <TextField label="Vehicle Model" placeholder="e.g. Corolla" value={vehicleModel} onChangeText={setVehicleModel} autoCapitalize="words" />
              <TextField label="License Plate" placeholder="e.g. CA 123-456" value={licensePlate} onChangeText={setLicensePlate} autoCapitalize="characters" />
            </GlassCard>
          </>
        )}

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

  identityCard: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  avatar: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: "rgba(255,46,46,0.14)",
    borderWidth: 1.5, borderColor: "rgba(255,46,46,0.35)",
    alignItems: "center", justifyContent: "center",
  },
  avatarTxt: { color: COLORS.red, fontWeight: "900", fontSize: 20 },
  nameTxt: { color: COLORS.text, fontWeight: "900", fontSize: 18 },
  usernameTxt: { color: COLORS.textFaint, fontSize: 12, marginTop: 1 },
  roleRow: { flexDirection: "row", alignItems: "center", gap: 8, marginTop: 8, flexWrap: "wrap" },
  roleBadge: {
    flexDirection: "row", alignItems: "center", gap: 5,
    backgroundColor: "rgba(255,46,46,0.10)", borderWidth: 1, borderColor: "rgba(255,46,46,0.20)",
    borderRadius: RADIUS.pill, paddingHorizontal: 9, paddingVertical: 4,
  },
  roleBadgeTxt: { color: COLORS.red, fontWeight: "800", fontSize: 11 },
  memberSince: { color: COLORS.textFaint, fontSize: 11 },

  statsCard: { gap: SPACE.sm },
  statsRow: { flexDirection: "row", alignItems: "center" },
  statItem: { flex: 1, alignItems: "center" },
  statDivider: { width: 1, height: 32, backgroundColor: "rgba(255,255,255,0.10)" },
  statLabel: { color: COLORS.textFaint, fontSize: 10, letterSpacing: 1, textTransform: "uppercase", fontWeight: "800" },
  statValue: { color: COLORS.text, fontSize: 18, fontWeight: "900", marginTop: 4 },
  verificationRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
    borderTopWidth: 1, borderTopColor: "rgba(255,255,255,0.08)", paddingTop: SPACE.sm,
  },
  verificationDot: { width: 7, height: 7, borderRadius: 4 },
  verificationTxt: { fontSize: 12, fontWeight: "800" },
  verificationLink: { color: COLORS.red, fontWeight: "900", fontSize: 12 },

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