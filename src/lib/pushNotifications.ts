import { Linking, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";
import { supabase } from "./supabase";

// Show a banner + sound while the app is in the foreground too (by default
// Expo suppresses foreground alerts).
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

export type PushPermissionResult = {
  granted: boolean;
  // false once the OS will no longer show its own permission dialog
  // again (e.g. the user already dismissed/denied it once) — the only
  // way to grant from here on is the system Settings app.
  canAskAgain: boolean;
};

// Requests the real OS notification permission — this is what actually
// controls whether a push can ever reach the device, independent of the
// `notify_push` preference row in `profiles` (which only controls
// whether the *server* bothers sending one). Callers that need to react
// to a hard denial (e.g. the in-app toggle) should use this directly
// instead of registerForPushNotificationsAsync, which swallows the
// distinction for its fire-and-forget use at login/app-open.
export async function ensurePushPermission(): Promise<PushPermissionResult> {
  if (!Device.isDevice) {
    // Simulators/emulators can't grant push permission at all — treat
    // this as "granted" so in-app UI doesn't dead-end during dev/testing.
    return { granted: true, canAskAgain: true };
  }

  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === "granted") {
    return { granted: true, canAskAgain: existing.canAskAgain ?? true };
  }
  if (!existing.canAskAgain) {
    return { granted: false, canAskAgain: false };
  }

  const requested = await Notifications.requestPermissionsAsync();
  return {
    granted: requested.status === "granted",
    canAskAgain: requested.canAskAgain ?? false,
  };
}

// Deep-links into this app's page in the system Settings app — the only
// way left to grant notification permission once canAskAgain is false.
export function openNotificationSettings(): void {
  if (Platform.OS === "ios") {
    Linking.openURL("app-settings:");
  } else {
    Linking.openSettings();
  }
}

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push tokens don't work in the iOS Simulator / Android emulator.
  if (!Device.isDevice) return null;

  const { granted } = await ensurePushPermission();
  if (!granted) return null;

  if (Platform.OS === "android") {
    await Notifications.setNotificationChannelAsync("default", {
      name: "default",
      importance: Notifications.AndroidImportance.MAX,
      vibrationPattern: [0, 250, 250, 250],
      lightColor: "#ff2e2e",
    });
  }

  // Requires the app to be linked to an EAS project (`eas init`) — without
  // this, projectId is undefined and getExpoPushTokenAsync throws.
  const projectId =
    Constants.expoConfig?.extra?.eas?.projectId ?? Constants.easConfig?.projectId;

  if (!projectId) {
    console.warn(
      "No EAS projectId configured (app.json extra.eas.projectId) — run `eas init` to enable push tokens."
    );
    return null;
  }

  try {
    const tokenResponse = await Notifications.getExpoPushTokenAsync({ projectId });
    return tokenResponse.data;
  } catch (e) {
    console.warn("Failed to get Expo push token", e);
    return null;
  }
}

export async function savePushToken(token: string): Promise<void> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return;
  await supabase.from("profiles").update({ push_token: token }).eq("id", userId);
}

// Convenience wrapper for the common case: get a token and save it,
// swallowing errors since push setup should never block app usage.
export async function registerAndSavePushToken(): Promise<string | null> {
  try {
    const token = await registerForPushNotificationsAsync();
    if (token) await savePushToken(token);
    return token;
  } catch {
    return null;
  }
}

// Fires when the user taps a notification (app in background or killed).
// `onNavigate` receives the `data` payload set server-side in
// 0011_push_notifications.sql (e.g. { type: "ride_message", rideId }).
export function addNotificationTapListener(onNavigate: (data: any) => void): () => void {
  const sub = Notifications.addNotificationResponseReceivedListener((response) => {
    onNavigate(response.notification.request.content.data);
  });
  return () => sub.remove();
}