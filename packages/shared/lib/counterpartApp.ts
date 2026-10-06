import { Linking, Platform } from "react-native";

import { COUNTERPART } from "./appConfig";
import { Alert } from "./themedAlert";

// Replaces the old in-app "Switch to Rider / Switch to Driver" mode
// switch. Riding and driving now live in separate apps, so switching
// sides means handing off to the other app — which then claims its own
// mode on open (see appMode.ts), exactly like the old switch did.
//
// Deliberately doesn't use Linking.canOpenURL first: on iOS that needs
// the other scheme listed in LSApplicationQueriesSchemes and on Android
// 11+ a <queries> manifest entry. openURL itself rejects cleanly when
// nothing handles the scheme, which is all we need to fall back to the
// store listing.
export async function openCounterpartApp(): Promise<void> {
  try {
    await Linking.openURL(`${COUNTERPART.scheme}://`);
    return;
  } catch {
    // Not installed — fall through to the store.
  }

  const storeUrl = counterpartStoreUrl();
  if (storeUrl) {
    try {
      await Linking.openURL(storeUrl);
      return;
    } catch {
      // Store app unavailable (emulator without Play Store, etc.)
    }
  }

  Alert.alert(
    `Get ${COUNTERPART.name}`,
    `Install the ${COUNTERPART.name} app from your app store, then sign in with this same username.`
  );
}

function counterpartStoreUrl(): string | null {
  if (Platform.OS === "android" && COUNTERPART.androidPackage) {
    return `https://play.google.com/store/apps/details?id=${COUNTERPART.androidPackage}`;
  }
  if (Platform.OS === "ios" && COUNTERPART.iosAppStoreUrl) {
    return COUNTERPART.iosAppStoreUrl;
  }
  return null;
}
