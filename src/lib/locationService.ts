// Unified location API — same shape as expo-location's, but routes actual
// position fixes through HMS Location Kit on Huawei/Honor devices without
// Google Play Services. Permission requests stay on expo-location
// everywhere: ACCESS_FINE_LOCATION is a standard Android runtime
// permission, not a Google Play Services feature, so it works identically
// on GMS and HMS hardware.
//
// Drop-in usage: replace `import * as Location from "expo-location"` with
// `import * as Location from "./locationService"` in map/location call
// sites. Same function names, same return shape.
//
// Requires (once HMS setup is done — see app.json / plugins/withHmsCore.js):
//   npm install @hmscore/react-native-hms-location
// Until installed, HMS devices fall back to expo-location, which will
// likely time out — that's the exact bug this file fixes once the
// package is in place.
import * as ExpoLocation from "expo-location";
import { detectMobileServiceProvider } from "./mobileServices";

export const Accuracy = ExpoLocation.Accuracy;

export type LocationObject = {
  coords: {
    latitude: number;
    longitude: number;
    altitude: number | null;
    accuracy: number | null;
    heading: number | null;
    speed: number | null;
  };
  timestamp: number;
};

export async function requestForegroundPermissionsAsync() {
  // Standard Android runtime permission — identical path on GMS and HMS.
  return ExpoLocation.requestForegroundPermissionsAsync();
}

export async function getForegroundPermissionsAsync() {
  return ExpoLocation.getForegroundPermissionsAsync();
}

function toLocationObject(hmsLoc: any): LocationObject {
  // HMS's Location interface has no `altitude` field (latitude, longitude,
  // speed, bearing, accuracy, time — see @hmscore/react-native-hms-location's
  // type defs), unlike expo-location's LocationObject. Always null here.
  return {
    coords: {
      latitude: hmsLoc.latitude,
      longitude: hmsLoc.longitude,
      altitude: null,
      accuracy: hmsLoc.accuracy ?? null,
      heading: hmsLoc.bearing ?? null,
      speed: hmsLoc.speed ?? null,
    },
    timestamp: hmsLoc.time ?? Date.now(),
  };
}

async function getHmsLocation(): Promise<LocationObject> {
  const mod = await import("@hmscore/react-native-hms-location");
  const HMSLocation = mod.default;
  const result = await HMSLocation.FusedLocation.Native.getLastLocation();
  return toLocationObject(result);
}

export async function getCurrentPositionAsync(
  options: { accuracy?: any } = {}
): Promise<LocationObject> {
  const provider = await detectMobileServiceProvider();
  if (provider === "hms") {
    try {
      return await getHmsLocation();
    } catch {
      // HMS package not installed yet, or the call failed — fall back to
      // expo-location so the app degrades to "may not get a fix" rather
      // than crashing outright.
    }
  }
  return ExpoLocation.getCurrentPositionAsync(options as any);
}

export type LocationSubscription = { remove: () => void };

// Continuous updates. On HMS, this polls getLastLocation on an interval
// rather than subscribing to HMS's native update stream — simpler and
// safer than guessing at HMS's callback-registration API shape, and the
// app already polls driver position on a similar cadence elsewhere
// (POLL_INTERVAL_MS in driverStatus/presence), so the practical behavior
// is equivalent. Swap this for a true push subscription
// (HMSLocation.FusedLocation.Native.requestLocationUpdatesWithCallback)
// later if battery testing shows polling isn't tight enough.
export async function watchPositionAsync(
  options: { accuracy?: any; timeInterval?: number; distanceInterval?: number },
  callback: (location: LocationObject) => void
): Promise<LocationSubscription> {
  const provider = await detectMobileServiceProvider();

  if (provider === "hms") {
    let cancelled = false;
    const intervalMs = options.timeInterval ?? 4000;
    const poll = async () => {
      if (cancelled) return;
      try {
        callback(await getHmsLocation());
      } catch {
        // transient miss — next tick will retry
      }
    };
    poll();
    const handle = setInterval(poll, intervalMs);
    return { remove: () => { cancelled = true; clearInterval(handle); } };
  }

  return ExpoLocation.watchPositionAsync(options as any, callback as any);
}
