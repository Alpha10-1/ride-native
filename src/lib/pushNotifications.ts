import { Platform } from "react-native";
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

export async function registerForPushNotificationsAsync(): Promise<string | null> {
  // Push tokens don't work in the iOS Simulator / Android emulator.
  if (!Device.isDevice) return null;

  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }
  if (finalStatus !== "granted") return null;

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