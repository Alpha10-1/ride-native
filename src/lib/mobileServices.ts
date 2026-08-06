// Detects whether the device runs on Google Mobile Services (GMS) or
// Huawei Mobile Services (HMS), so map + location code can pick the right
// backend at runtime.
//
// Why this exists: react-native-maps' PROVIDER_GOOGLE and expo-location
// both depend on Google Play Services. Huawei/Honor phones released after
// the 2019 US trade restrictions (P40 onward, Mate 30 onward, most 2020+
// Honor devices) ship WITHOUT Google Play Services — they run HMS Core
// instead. On those devices, PROVIDER_GOOGLE renders a blank/stuck map and
// expo-location silently fails to get a fix, since there's no Fused
// Location Provider to call.
//
// Requires (once you have Huawei AppGallery Connect set up):
//   npm install @hmscore/react-native-hms-availability
// Until that package is installed, detection falls back to a
// manufacturer-only heuristic — see the comment below.
import { Platform } from "react-native";
import * as Device from "expo-device";

export type MobileServiceProvider = "gms" | "hms";

// Manufacturers whose current lineup ships HMS-only. Older devices from
// these brands (pre-2019, e.g. P30, Mate 20) may still carry GMS — the
// runtime HMS Core check below is the source of truth; this list only
// decides which check we bother running first.
const HMS_MANUFACTURERS = ["HUAWEI", "HONOR"];

let cached: MobileServiceProvider | null = null;

export async function detectMobileServiceProvider(): Promise<MobileServiceProvider> {
  // iOS and web always use Apple Maps / browser geolocation — no GMS/HMS
  // split exists there, so there's nothing to detect.
  if (Platform.OS !== "android") return "gms";
  if (cached) return cached;

  const manufacturer = (Device.manufacturer || "").toUpperCase();
  if (!HMS_MANUFACTURERS.includes(manufacturer)) {
    cached = "gms";
    return cached;
  }

  // On known HMS-first hardware, confirm HMS Core is actually installed
  // and usable rather than assuming from manufacturer alone.
  try {
    // Lazy import: this package isn't installed until HMS setup is done
    // (see app.json / plugins/withHmsCore.js). Until then this throws and
    // we fall through to the manufacturer heuristic below.
    const mod = await import("@hmscore/react-native-hms-availability");
    // The package's shipped .d.ts doesn't declare a default export even
    // though the runtime module has one (an already-instantiated
    // HMSAvailability) — cast through `any` to work around the
    // incomplete upstream types rather than fighting them here.
    const HMSAvailability = (mod as any).default;
    // Resolves to a numeric result code; 0 (ErrorCode.HMS_CORE_APK_AVAILABLE)
    // means HMS Core is installed and up to date.
    const resultCode = await HMSAvailability.isHuaweiMobileServicesAvailable();
    cached = resultCode === 0 ? "hms" : "gms";
  } catch {
    // Package not installed yet, or the native check itself failed.
    // Route away from Google Maps on known-HMS hardware anyway — a blank
    // Google Maps view is a worse failure mode than assuming HMS on a
    // Huawei/Honor phone that happens to still have GMS.
    cached = "hms";
  }

  return cached;
}

// Exposed for tests and for the (rare) case where a user's Play/HMS Core
// install state changes mid-session — e.g. they just installed HMS Core
// after being prompted.
export function resetMobileServiceProviderCache() {
  cached = null;
}
