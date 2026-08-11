import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import { Alert } from "../lib/themedAlert";
import { router } from "expo-router";
import { resetTo } from "../lib/navigation";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import GlassCard from "../components/GlassCard";
import RowItem from "../components/RowItem";
import PrimaryButton from "../components/PrimaryButton";
import { COLORS, SPACE } from "../theme/tokens";
import { deleteAccount, getCurrentProfile } from "../lib/auth";
import { getMyRideDataExport, exportRideDataPdf } from "../lib/dataExport";

export default function PrivacyScreen() {
  const [deleting, setDeleting] = useState(false);
  const [requestingData, setRequestingData] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");

  useEffect(() => {
    getCurrentProfile().then((p) => { if (p) setRole(p.role); }).catch(() => {});
  }, []);

  const handleRequestData = async () => {
    if (requestingData) return;
    setRequestingData(true);
    try {
      const profile = await getCurrentProfile();
      const riderName = profile
        ? [profile.first_name, profile.last_name].filter(Boolean).join(" ").trim()
        : "";
      const rides = await getMyRideDataExport();
      await exportRideDataPdf({ riderName: riderName || "Rider", rides });
    } catch (e: any) {
      Alert.alert(
        "Couldn't prepare your data",
        e?.message ?? "Something went wrong. Please try again."
      );
    } finally {
      setRequestingData(false);
    }
  };

  const handleDeleteAccount = () => {
    // First confirmation
    Alert.alert(
      "Delete Account",
      "This will permanently delete your account, wallet, saved places, and all associated data. This cannot be undone.",
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Continue",
          style: "destructive",
          onPress: () => {
            // Second confirmation — makes accidental deletion much harder
            Alert.alert(
              "Are you absolutely sure?",
              "Your account and all data will be permanently deleted. There is no way to recover it.",
              [
                { text: "Cancel", style: "cancel" },
                {
                  text: "Delete My Account",
                  style: "destructive",
                  onPress: async () => {
                    setDeleting(true);
                    try {
                      await deleteAccount();
                      resetTo("/auth/login");
                    } catch (e: any) {
                      setDeleting(false);
                      Alert.alert(
                        "Deletion failed",
                        e?.message ?? "Something went wrong. Please try again."
                      );
                    }
                  },
                },
              ]
            );
          },
        },
      ]
    );
  };

  return (
    <Screen>
      <RiderHeader subtitle="Privacy" menuOpen={false} onMenu={() => router.back()} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard>
          <Text style={styles.kicker}>YOUR DATA</Text>
          <Text style={styles.sub}>
            Ride collects information needed to provide safe, reliable transport services. This includes your location during trips, ride history, and payment information. We never sell your personal data to third parties.
          </Text>
        </GlassCard>

        <Text style={styles.section}>What We Collect</Text>
        <GlassCard style={{ gap: SPACE.sm }}>
          {[
            ["Location", "During active trips to connect riders and drivers."],
            ["Profile info", "Name, phone, email for account management."],
            ["Trip history", "Past rides for receipts and support."],
            ["Device info", "App version and OS for debugging and support."],
          ].map(([title, desc]) => (
            <View key={title} style={styles.dataItem}>
              <Text style={styles.dataTitle}>{title}</Text>
              <Text style={styles.dataDesc}>{desc}</Text>
            </View>
          ))}
        </GlassCard>

        <Text style={styles.section}>Your Rights</Text>
        <RowItem
          icon="download-outline"
          title="Request my data"
          subtitle={
            requestingData
              ? "Preparing your data…"
              : "Get a copy of your ride history, payments, and drivers"
          }
          onPress={handleRequestData}
          showChevron={!requestingData}
        />
        <RowItem
          icon="document-text-outline"
          title="Full Privacy Policy"
          subtitle="Detailed data handling policy"
          onPress={() => router.push({
            pathname: role === "driver" ? "/(driver)/legal-doc" : "/(rider)/legal-doc",
            params: { docKey: "privacy_policy" },
          })}
        />

        <Text style={[styles.section, { color: COLORS.red }]}>Danger Zone</Text>
        <GlassCard style={styles.dangerCard}>
          <Text style={styles.dangerTitle}>Delete Account</Text>
          <Text style={styles.dangerDesc}>
            Permanently deletes your account, wallet balance, saved places, and all associated data. This action is irreversible.
          </Text>
          <View style={{ marginTop: SPACE.md }}>
            <PrimaryButton
              label={deleting ? "Deleting..." : "Delete My Account"}
              onPress={handleDeleteAccount}
              disabled={deleting}
              danger
            />
          </View>
        </GlassCard>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  sub: { color: COLORS.textDim, marginTop: 6, fontSize: 13, lineHeight: 20 },
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
  dataItem: {
    gap: 3,
  },
  dataTitle: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 13,
  },
  dataDesc: {
    color: COLORS.textDim,
    fontSize: 12,
  },
  dangerCard: {
    borderColor: "rgba(255,46,46,0.3)",
  },
  dangerTitle: {
    color: COLORS.red,
    fontWeight: "900",
    fontSize: 15,
  },
  dangerDesc: {
    color: COLORS.textDim,
    fontSize: 13,
    marginTop: 6,
    lineHeight: 18,
  },
});