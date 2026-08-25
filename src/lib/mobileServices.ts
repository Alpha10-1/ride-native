// Detects whether the device runs on Google Mobile Services (GMS) or
// Huawei Mobile Services (HMS), so map + location code can pick the right
// backend at runtime.
//
// Why this exists: react-native-maps' PROVIDER_GOOGLE and expo-location
// both depend on Google Play Services. Huawei phones released after the
// 2019 US trade restrictions ship WITHOUT Google Play Services — they run
// HMS Core instead. On those devices, PROVIDER_GOOGLE renders a
// blank/stuck map and expo-location silently fails to get a fix, since
// there's no Fused Location Provider to call.
//
// IMPORTANT — this is GMS-first, not manufacturer-first. An earlier
// version of this function treated "manufacturer is Huawei or Honor" as a
// proxy for "no GMS", which was true when it was written but stopped
// being true for Honor specifically: Honor split off from Huawei in late
// 2020 specifically to get out from under the US restriction, and Honor
// phones from the Honor 50 (2021) onward ship with real, working GMS
// again — often *alongside* leftover HMS Core infrastructure. Checking
// manufacturer name alone can't tell those two cases apart; only checking
// actual on-device service availability can. So this checks GMS
// availability directly and prefers it whenever it's genuinely present,
// regardless of brand — HMS is only used when GMS is truly absent.
//
// Requires:
//   npm install react-native-device-info
// which exposes hasGms()/hasHms() purpose-built for exactly this check
// (backed by Google Play Services' own GoogleApiAvailability API under
// the hood, not a name-based guess).
import { Platform } from "react-native";
import DeviceInfo from "react-native-device-info";

export type MobileServiceProvider = "gms" | "hms";

let cached: MobileServiceProvider | null = null;

export async function detectMobileServiceProvider(): Promise<MobileServiceProvider> {
  // iOS and web always use Apple Maps / browser geolocation — no GMS/HMS
  // split exists there, so there's nothing to detect.
  if (Platform.OS !== "android") return "gms";
  if (cached) return cached;

  try {
    // hasGms() checks real GMS availability on-device (Google Play
    // Services' own availability API), not a manufacturer guess. Prefer
    // it whenever present — it's the better-tested, default path, and
    // plenty of current Honor/even some Huawei devices genuinely have it.
    const gmsAvailable = await DeviceInfo.hasGms();
    if (gmsAvailable) {
      cached = "gms";
      return cached;
    }

    const hmsAvailable = await DeviceInfo.hasHms();
    cached = hmsAvailable ? "hms" : "gms";
  } catch {
    // If the check itself fails for some reason, default to GMS — it's
    // the far more common case across the installed base, and a failed
    // detection shouldn't force every device down the less-tested HMS
    // path.
    cached = "gms";
  }

  return cached;
}

// Exposed for tests and for the (rare) case where a user's Play/HMS Core
// install state changes mid-session — e.g. they just installed HMS Core
// after being prompted.
export function resetMobileServiceProviderCache() {
  cached = null;
}