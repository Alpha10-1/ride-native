import { useEffect } from "react";
import { Stack, router } from "expo-router";
import { SafeAreaProvider } from "react-native-safe-area-context";

import { supabase } from "../lib/supabase";
import { registerAndSavePushToken, addNotificationTapListener } from "../lib/pushNotifications";
import { resetTo } from "../lib/navigation";
import { Alert, AlertProvider } from "../lib/themedAlert";
import ErrorBoundary from "../components/ErrorBoundary";
import ModeGate from "../components/ModeGate";
import { IS_DRIVER_APP } from "../lib/appConfig";

type NotificationData = { type?: string; rideId?: string };
type Target = string | { pathname: string; params: Record<string, string> };

// Where tapping a push notification should land. Each app only contains
// its own screens, so this routes by which app received the tap rather
// than by profiles.role/active_mode like the single app had to. The
// server sends driver events to the driver app's token and rider events
// to the rider app's token (20261006120000_split_apps_push_tokens.sql).
function notificationTarget(data: NotificationData): Target | null {
  const ride = (pathname: string): Target | null =>
    data.rideId ? { pathname, params: { rideId: data.rideId } } : null;

  if (IS_DRIVER_APP) {
    switch (data.type) {
      case "ride_status": return ride("/(driver)/active-trip");
      case "ride_message": return ride("/(driver)/ride-chat");
      case "ride_offer": return ride("/(driver)/requests");
      case "new_ride_request": return "/(driver)/requests";
      case "support_message": return "/(driver)/support-chat";
      case "sos_alert": return "/(driver)/safety";
      default: return null;
    }
  }

  switch (data.type) {
    case "ride_status": return ride("/(rider)/ride-tracking");
    case "ride_message": return ride("/(rider)/ride-chat");
    case "ride_offer": return ride("/(rider)/ride-tracking");
    case "support_message": return "/(rider)/support-chat";
    case "sos_alert": return "/(rider)/safety";
    // new_ride_request is driver-only; one landing here is a stale token
    // from before the split, so just open the app normally.
    default: return null;
  }
}

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
          "This account is for the admin dashboard, not the Ride apps."
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
      if (!session.session?.user.id) return;

      const target = notificationTarget(data);
      if (target) router.push(target as any);
    });

    return unsubscribe;
  }, []);

  return (
    <SafeAreaProvider>
      <AlertProvider>
        <ErrorBoundary>
          <Stack
            screenOptions={{
              headerShown: false,
              animation: "fade",
            }}
          />
        </ErrorBoundary>
        <ModeGate />
      </AlertProvider>
    </SafeAreaProvider>
  );
}