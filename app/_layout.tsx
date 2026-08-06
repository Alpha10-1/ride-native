import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { Alert } from "react-native";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { supabase } from "../src/lib/supabase";
import { registerAndSavePushToken, addNotificationTapListener } from "../src/lib/pushNotifications";
import { resetTo } from "../src/lib/navigation";

export default function RootLayout() {
  useEffect(() => {
    // Covers the "already logged in, just reopened the app" case — fresh
    // logins/signups are handled in redirectAfterAuth() in auth.ts. Also
    // covers an account being suspended while a session is still active —
    // this re-checks every time the app is opened, not just at login.
    supabase.auth.getSession().then(async ({ data }) => {
      if (!data.session) return;
      const { data: profile } = await supabase
        .from("profiles")
        .select("role, is_suspended, suspension_reason")
        .eq("id", data.session.user.id)
        .single();

      if (profile?.role === "staff") {
        await supabase.auth.signOut();
        Alert.alert(
          "Staff account",
          "This account is for the admin dashboard, not the rider/driver app."
        );
        resetTo("/auth/login");
        return;
      }

      if (profile?.is_suspended) {
        await supabase.auth.signOut();
        Alert.alert(
          "Account suspended",
          profile.suspension_reason
            ? `Your account has been suspended: ${profile.suspension_reason}`
            : "Your account has been suspended. Contact support for details."
        );
        resetTo("/auth/login");
        return;
      }

      registerAndSavePushToken().catch(() => {});
    });

    const unsubscribe = addNotificationTapListener(async (data) => {
      if (!data) return;

      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role, active_mode")
        .eq("id", userId)
        .single();
      const role = profile?.role ?? "rider";
      // active_mode reflects which side of the app a dual-role account is
      // currently using — role alone never changes back once someone
      // registers as a driver, so it can't tell "switched to rider" apart
      // from "still driving" the way active_mode can.
      const activeMode = profile?.active_mode ?? role;

      if (data.type === "ride_status" && data.rideId) {
        router.push({
          pathname: role === "driver" ? "/(driver)/active-trip" : "/(rider)/ride-tracking",
          params: { rideId: data.rideId },
        });
      } else if (data.type === "ride_message" && data.rideId) {
        router.push({
          pathname: role === "driver" ? "/(driver)/ride-chat" : "/(rider)/ride-chat",
          params: { rideId: data.rideId },
        });
      } else if (data.type === "ride_offer" && data.rideId) {
        router.push({
          pathname: role === "driver" ? "/(driver)/requests" : "/(rider)/ride-tracking",
          params: { rideId: data.rideId },
        });
      } else if (data.type === "support_message") {
        router.push(role === "driver" ? "/(driver)/support-chat" : "/(rider)/support-chat");
      } else if (data.type === "new_ride_request") {
        // Driver-only, and unlike the cases above there's no specific
        // ride this account is already a party to — this is purely "are
        // you currently driving", so active_mode is the right check,
        // not the static signup role.
        if (activeMode === "driver") {
          router.push("/(driver)/requests");
        }
      } else if (data.type === "sos_alert") {
        router.push(role === "driver" ? "/(driver)/safety" : "/(rider)/safety");
      }
    });

    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <Stack
        screenOptions={{
          headerShown: false,
          animation: "fade",
        }}
      />
    </SafeAreaProvider>
  );
}