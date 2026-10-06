import React, { useEffect, useState } from "react";
import { View, Text, StyleSheet, Switch, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Alert } from "../lib/themedAlert";
import { resetTo } from "../lib/navigation";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import GlassCard from "../components/GlassCard";
import { COLORS, SPACE } from "../theme/tokens";
import { getCurrentProfile, updatePreferences } from "../lib/auth";
import { ensurePushPermission, openNotificationSettings, registerAndSavePushToken } from "../lib/pushNotifications";

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
          resetTo("/auth/login");
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
    // Turning it off never needs the OS permission — just stop the
    // server from sending (the trigger functions check notify_push).
    if (!value) {
      setPushEnabled(false);
      setSaving(true);
      setError(null);
      try {
        await updatePreferences({ notifyPush: false });
      } catch (e: any) {
        setPushEnabled(true);
        setError(e?.message ?? "Failed to save.");
      } finally {
        setSaving(false);
      }
      return;
    }

    // Turning it on requires the real OS permission — flipping this
    // preference alone doesn't get a notification onto the device.
    setSaving(true);
    setError(null);
    try {
      const { granted, canAskAgain } = await ensurePushPermission();
      if (!granted) {
        setPushEnabled(false);
        if (!canAskAgain) {
          Alert.alert(
            "Notifications are off",
            "Notifications for RIDE are turned off in your phone's settings. Open Settings to turn them back on.",
            [
              { text: "Not now", style: "cancel" },
              { text: "Open Settings", onPress: () => openNotificationSettings() },
            ]
          );
        } else {
          setError("Notification permission is required to enable push notifications.");
        }
        return;
      }

      setPushEnabled(true);
      await updatePreferences({ notifyPush: true });
      // Permission may have just been granted for the first time —
      // make sure the current push token is actually saved server-side.
      registerAndSavePushToken().catch(() => {});
    } catch (e: any) {
      setPushEnabled(false);
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