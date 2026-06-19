import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, ActivityIndicator } from "react-native";
import { router } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE } from "../../src/theme/tokens";
import { getCurrentProfile, updatePreferences } from "../../src/lib/auth";

export default function NotificationsScreen() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pushEnabled, setPushEnabled] = useState(true);
  const [smsEnabled, setSmsEnabled] = useState(true);

  useEffect(() => {
    (async () => {
      try {
        const profile = await getCurrentProfile();
        if (!profile) {
          router.replace("/auth/login");
          return;
        }
        setPushEnabled(profile.notify_push ?? true);
        setSmsEnabled(profile.notify_sms ?? true);
      } catch (e: any) {
        setError(e?.message ?? "Failed to load preferences.");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  const handleTogglePush = async (value: boolean) => {
    setPushEnabled(value);
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({ notifyPush: value });
    } catch (e: any) {
      setPushEnabled(!value);
      setError(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  const handleToggleSms = async (value: boolean) => {
    setSmsEnabled(value);
    setSaving(true);
    setError(null);
    try {
      await updatePreferences({ notifySms: value });
    } catch (e: any) {
      setSmsEnabled(!value);
      setError(e?.message ?? "Failed to save.");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Notifications" menuOpen={false} onMenu={() => router.back()} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Notifications" menuOpen={false} onMenu={() => router.back()} />
      <View style={{ paddingHorizontal: SPACE.md, gap: SPACE.sm }}>
        <GlassCard>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>Push Notifications</Text>
              <Text style={styles.subtitle}>Ride updates, driver arrival, promotions</Text>
            </View>
            <Switch
              value={pushEnabled}
              onValueChange={handleTogglePush}
              trackColor={{ false: "rgba(255,255,255,0.15)", true: COLORS.red }}
              thumbColor="#fff"
              disabled={saving}
            />
          </View>
        </GlassCard>

        <GlassCard>
          <View style={styles.row}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title}>SMS Notifications</Text>
              <Text style={styles.subtitle}>Trip confirmations and OTPs</Text>
            </View>
            <Switch
              value={smsEnabled}
              onValueChange={handleToggleSms}
              trackColor={{ false: "rgba(255,255,255,0.15)", true: COLORS.red }}
              thumbColor="#fff"
              disabled={saving}
            />
          </View>
        </GlassCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}
      </View>
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: SPACE.sm,
  },
  title: {
    color: COLORS.text,
    fontWeight: "800",
    fontSize: 15,
  },
  subtitle: {
    color: COLORS.textDim,
    fontSize: 12,
    marginTop: 4,
  },
  error: {
    color: "rgba(255,90,90,0.95)",
    marginTop: SPACE.sm,
    fontWeight: "700",
    textAlign: "center",
  },
});