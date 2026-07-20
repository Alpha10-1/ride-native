import { useEffect } from "react";
import { Stack, router } from "expo-router";

import { supabase } from "../src/lib/supabase";
import { registerAndSavePushToken, addNotificationTapListener } from "../src/lib/pushNotifications";

export default function RootLayout() {
  useEffect(() => {
    // Covers the "already logged in, just reopened the app" case — fresh
    // logins/signups are handled in redirectAfterAuth() in auth.ts.
    supabase.auth.getSession().then(({ data }) => {
      if (data.session) registerAndSavePushToken().catch(() => {});
    });

    const unsubscribe = addNotificationTapListener(async (data) => {
      if (!data) return;

      const { data: session } = await supabase.auth.getSession();
      const userId = session.session?.user.id;
      if (!userId) return;

      const { data: profile } = await supabase
        .from("profiles")
        .select("role")
        .eq("id", userId)
        .single();
      const role = profile?.role ?? "rider";

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
        // Only meaningful for a driver — a rider would never receive this
        // push type, but guard anyway.
        if (role === "driver") {
          router.push("/(driver)/requests");
        }
      } else if (data.type === "sos_alert") {
        router.push(role === "driver" ? "/(driver)/safety" : "/(rider)/safety");
      }
    });

    return unsubscribe;
  }, []);

  return (
    <Stack
      screenOptions={{
        headerShown: false,
        animation: "fade",
      }}
    />
  );
}