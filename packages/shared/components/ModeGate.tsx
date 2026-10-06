import React, { useEffect, useState } from "react";
import { AppState, Pressable, StyleSheet, Text, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";

import GlassCard from "./GlassCard";
import PrimaryButton from "./PrimaryButton";
import { COLORS, SPACE } from "../theme/tokens";
import { supabase } from "../lib/supabase";
import { COUNTERPART, IS_DRIVER_APP } from "../lib/appConfig";
import {
  ModeGateState, ensureAppMode, getModeGateState, resetModeGate, subscribeModeGate,
} from "../lib/appMode";
import { openCounterpartApp } from "../lib/counterpartApp";
import { logout } from "../lib/auth";
import { resetTo } from "../lib/navigation";

// Mounted once in the root layout. Re-claims this app's mode every time
// the app comes back to the foreground (the split-app equivalent of the
// old in-app Switch to Rider/Driver — see lib/appMode.ts), and covers the
// screen when that isn't safe to do automatically.
//
// Cold start and fresh sign-in are handled by redirectAfterAuth(), which
// calls ensureAppMode() itself before routing, so this only needs to
// react to background -> foreground transitions.
export default function ModeGate() {
  const [state, setState] = useState<ModeGateState>(getModeGateState());
  const [busy, setBusy] = useState(false);

  useEffect(() => subscribeModeGate(setState), []);

  useEffect(() => {
    let previous = AppState.currentState;
    const sub = AppState.addEventListener("change", async (next) => {
      const cameToForeground = previous !== "active" && next === "active";
      previous = next;
      if (!cameToForeground) return;
      const { data } = await supabase.auth.getSession();
      if (data.session) ensureAppMode();
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    const { data } = supabase.auth.onAuthStateChange((event) => {
      if (event === "SIGNED_OUT") resetModeGate();
    });
    return () => data.subscription.unsubscribe();
  }, []);

  if (state.kind !== "busy_on_other_side" && state.kind !== "online_as_driver") {
    return null;
  }

  const run = async (fn: () => Promise<unknown>) => {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
    } finally {
      setBusy(false);
    }
  };

  const signOut = () =>
    run(async () => {
      await logout().catch(() => {});
      resetTo("/auth/login");
    });

  let icon: React.ComponentProps<typeof Ionicons>["name"];
  let title: string;
  let body: string;
  let primary: { label: string; onPress: () => void };
  let secondary: { label: string; onPress: () => void };

  if (state.kind === "online_as_driver") {
    icon = "car-sport-outline";
    title = `You're online in ${COUNTERPART.name}`;
    body =
      "Booking a ride here takes you offline as a driver, so you'll stop " +
      "receiving trip requests until you go online again.";
    primary = {
      label: busy ? "Going offline..." : "Go offline and continue",
      onPress: () => run(() => ensureAppMode({ goOffline: true })),
    };
    secondary = { label: `Open ${COUNTERPART.name}`, onPress: () => openCounterpartApp() };
  } else {
    icon = IS_DRIVER_APP ? "person-outline" : "car-sport-outline";
    title = IS_DRIVER_APP ? "You're on a ride right now" : `You have a trip in progress in ${COUNTERPART.name}`;
    body = IS_DRIVER_APP
      ? `Your current ride is in the ${COUNTERPART.name} app. You can drive once it has finished.`
      : `Finish or cancel that trip in ${COUNTERPART.name} before booking a ride here.`;
    primary = { label: `Open ${COUNTERPART.name}`, onPress: () => openCounterpartApp() };
    secondary = {
      label: busy ? "Checking..." : "Check again",
      onPress: () => run(() => ensureAppMode()),
    };
  }

  return (
    <View style={styles.backdrop} pointerEvents="auto">
      <GlassCard style={styles.card}>
        <Ionicons name={icon} size={30} color={COLORS.red} />
        <Text style={styles.title}>{title}</Text>
        <Text style={styles.body}>{body}</Text>
        <View style={styles.actions}>
          <PrimaryButton label={primary.label} onPress={primary.onPress} disabled={busy} />
          <Pressable onPress={secondary.onPress} disabled={busy} hitSlop={8} style={styles.secondaryBtn}>
            <Text style={styles.secondaryTxt}>{secondary.label}</Text>
          </Pressable>
          <Pressable onPress={signOut} disabled={busy} hitSlop={8} style={styles.centered}>
            <Text style={styles.signOutTxt}>Sign out</Text>
          </Pressable>
        </View>
      </GlassCard>
    </View>
  );
}

const styles = StyleSheet.create({
  // Above SideMenuDrawer (zIndex/elevation 999) and every sheet. Android
  // needs elevation as well as zIndex for this to win both painting and
  // touch handling — same reasoning as SideMenuDrawer's own overlay.
  backdrop: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 2000,
    elevation: 2000,
    backgroundColor: "rgba(0,0,0,0.92)",
    justifyContent: "center",
    paddingHorizontal: SPACE.lg,
  },
  card: { alignItems: "center", gap: SPACE.sm, paddingVertical: SPACE.xl },
  title: { color: COLORS.text, fontSize: 20, fontWeight: "900", textAlign: "center" },
  body: { color: COLORS.textDim, fontSize: 14, lineHeight: 20, textAlign: "center" },
  actions: { alignSelf: "stretch", gap: SPACE.md, marginTop: SPACE.sm },
  secondaryBtn: { alignSelf: "center", paddingVertical: 4 },
  centered: { alignSelf: "center" },
  secondaryTxt: { color: COLORS.red, fontWeight: "800", fontSize: 14 },
  signOutTxt: { color: COLORS.textFaint, fontWeight: "700", fontSize: 13 },
});
