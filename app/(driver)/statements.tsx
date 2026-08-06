import React, { useCallback, useEffect, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Pressable, Alert } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getCurrentProfile } from "../../src/lib/auth";
import { formatFare } from "../../src/lib/rides";
import {
  StatementPeriod, StatementTrip,
  getPeriodBounds, shiftPeriod, formatPeriodLabel,
  getDriverStatement, summarizeStatement, exportStatementPdf,
} from "../../src/lib/statements";

export default function StatementsScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [period, setPeriod] = useState<StatementPeriod>("weekly");
  const [anchor, setAnchor] = useState(new Date());
  const [trips, setTrips] = useState<StatementTrip[]>([]);
  const [loading, setLoading] = useState(true);
  const [exporting, setExporting] = useState(false);
  const [driverName, setDriverName] = useState("Driver");
  const [vehicleLabel, setVehicleLabel] = useState<string | undefined>(undefined);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { start, end } = getPeriodBounds(period, anchor);
      const [data, profile] = await Promise.all([
        getDriverStatement(start, end),
        getCurrentProfile(),
      ]);
      setTrips(data);
      if (profile) {
        setDriverName(`${profile.first_name} ${profile.last_name}`.trim());
        const vehicleBits = [
          [profile.vehicle_make, profile.vehicle_model].filter(Boolean).join(" "),
          profile.license_plate,
        ].filter(Boolean);
        setVehicleLabel(vehicleBits.length ? vehicleBits.join(" · ") : undefined);
      }
    } catch {
      setTrips([]);
    } finally {
      setLoading(false);
    }
  }, [period, anchor]);

  useFocusEffect(useCallback(() => { load(); }, [load]));
  useEffect(() => { load(); }, [period, anchor]);

  const summary = summarizeStatement(trips);
  const isCurrentPeriod = (() => {
    const { start, end } = getPeriodBounds(period, anchor);
    const now = new Date();
    return now >= start && now < end;
  })();

  const handleExport = async () => {
    setExporting(true);
    try {
      const { start } = getPeriodBounds(period, anchor);
      const { savedToDevice } = await exportStatementPdf({
        driverName,
        vehicleLabel,
        period,
        periodLabel: formatPeriodLabel(period, anchor),
        periodStart: start,
        trips,
      });
      if (savedToDevice) {
        Alert.alert("Statement saved", "Saved to the folder you chose — check your Files app or Downloads.");
      }
    } catch (e: any) {
      Alert.alert("Couldn't export statement", e?.message ?? "Please try again.");
    } finally {
      setExporting(false);
    }
  };

  return (
    <Screen>
      <RiderHeader subtitle="Statements" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <View style={styles.periodToggle}>
          <Pressable
            style={[styles.periodBtn, period === "weekly" && styles.periodBtnActive]}
            onPress={() => { setPeriod("weekly"); setAnchor(new Date()); }}
          >
            <Text style={[styles.periodBtnTxt, period === "weekly" && styles.periodBtnTxtActive]}>Weekly</Text>
          </Pressable>
          <Pressable
            style={[styles.periodBtn, period === "monthly" && styles.periodBtnActive]}
            onPress={() => { setPeriod("monthly"); setAnchor(new Date()); }}
          >
            <Text style={[styles.periodBtnTxt, period === "monthly" && styles.periodBtnTxtActive]}>Monthly</Text>
          </Pressable>
        </View>

        <View style={styles.navRow}>
          <Pressable style={styles.navBtn} onPress={() => setAnchor((a) => shiftPeriod(period, a, -1))}>
            <Ionicons name="chevron-back" size={18} color={COLORS.text} />
          </Pressable>
          <Text style={styles.periodLabel}>{formatPeriodLabel(period, anchor)}</Text>
          <Pressable
            style={[styles.navBtn, isCurrentPeriod && { opacity: 0.3 }]}
            disabled={isCurrentPeriod}
            onPress={() => setAnchor((a) => shiftPeriod(period, a, 1))}
          >
            <Ionicons name="chevron-forward" size={18} color={COLORS.text} />
          </Pressable>
        </View>

        {loading ? (
          <View style={styles.centerFill}>
            <ActivityIndicator color={COLORS.red} />
          </View>
        ) : (
          <>
            <GlassCard style={styles.summaryCard}>
              <View style={styles.summaryRow}>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Trips</Text>
                  <Text style={styles.summaryValue}>{summary.tripCount}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Earnings</Text>
                  <Text style={styles.summaryValue}>{formatFare(summary.totalEarningsCents)}</Text>
                </View>
                <View style={styles.summaryItem}>
                  <Text style={styles.summaryLabel}>Distance</Text>
                  <Text style={styles.summaryValue}>{summary.totalDistanceKm.toFixed(1)} km</Text>
                </View>
              </View>
              <PrimaryButton
                label={exporting ? "Preparing PDF..." : "Export as PDF"}
                onPress={handleExport}
                disabled={exporting || trips.length === 0}
              />
            </GlassCard>

            <Text style={styles.section}>Trips</Text>
            {trips.length === 0 ? (
              <Text style={styles.emptyTxt}>No completed trips in this period.</Text>
            ) : (
              trips.map((t) => (
                <GlassCard key={t.trip_id} style={styles.tripRow}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.tripDate}>
                      {new Date(t.completed_at).toLocaleDateString("en-ZA", { weekday: "short", day: "2-digit", month: "short" })}
                    </Text>
                    <Text style={styles.tripAddr} numberOfLines={1}>
                      {t.pickup_address} → {t.destination_address}
                    </Text>
                    <Text style={styles.tripMeta}>
                      {t.actual_distance_km?.toFixed(1) ?? "—"} km · {t.ride_tier}
                    </Text>
                  </View>
                  <Text style={styles.tripFare}>{formatFare(t.final_fare_cents)}</Text>
                </GlassCard>
              ))
            )}
          </>
        )}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { alignItems: "center", justifyContent: "center", paddingVertical: 60 },
  periodToggle: {
    flexDirection: "row", backgroundColor: "rgba(255,255,255,0.05)",
    borderRadius: RADIUS.pill, padding: 4, borderWidth: 1, borderColor: "rgba(255,255,255,0.08)",
  },
  periodBtn: { flex: 1, alignItems: "center", paddingVertical: 10, borderRadius: RADIUS.pill },
  periodBtnActive: { backgroundColor: COLORS.red },
  periodBtnTxt: { color: COLORS.textDim, fontWeight: "800", fontSize: 13 },
  periodBtnTxtActive: { color: "#000" },
  navRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingHorizontal: 4 },
  navBtn: {
    width: 36, height: 36, borderRadius: 18, alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)", borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  periodLabel: { color: COLORS.text, fontWeight: "900", fontSize: 15 },
  summaryCard: { gap: SPACE.sm },
  summaryRow: { flexDirection: "row" },
  summaryItem: { flex: 1 },
  summaryLabel: { color: COLORS.textFaint, fontSize: 11, letterSpacing: 1, textTransform: "uppercase", fontWeight: "800" },
  summaryValue: { color: COLORS.text, fontSize: 18, fontWeight: "900", marginTop: 4 },
  section: {
    marginTop: SPACE.md, marginBottom: 2, paddingLeft: 4,
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  emptyTxt: { color: COLORS.textFaint, fontSize: 13, paddingLeft: 4 },
  tripRow: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  tripDate: { color: COLORS.textFaint, fontSize: 11, fontWeight: "700" },
  tripAddr: { color: COLORS.text, fontSize: 13, fontWeight: "700", marginTop: 2 },
  tripMeta: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  tripFare: { color: COLORS.red, fontWeight: "900", fontSize: 15 },
});