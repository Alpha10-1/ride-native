import { useEffect, useState } from "react";
import * as Location from "expo-location";

import { setDriverOnlineStatus, updateMyLocation } from "./presence";

// Shared online/offline state across screens (Home, Requests, etc.), now
// backed by the DB (see 0012_driver_presence_and_nearby_push.sql) so
// nearby-driver push for new ride requests actually has something to
// match against. The in-memory flag here still exists so the UI doesn't
// need to wait on a network round-trip just to flip the switch visually —
// the DB sync happens alongside it, best-effort.

type Listener = (online: boolean) => void;

let online = false;
const listeners = new Set<Listener>();
let refreshTimer: ReturnType<typeof setInterval> | null = null;

const REFRESH_INTERVAL_MS = 25_000;

async function getCurrentCoords(): Promise<{ lat: number; lng: number } | null> {
  try {
    const { status } = await Location.getForegroundPermissionsAsync();
    if (status !== "granted") return null;
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  } catch {
    return null;
  }
}

async function pushLocationRefresh() {
  const coords = await getCurrentCoords();
  if (!coords) return;
  updateMyLocation(coords.lat, coords.lng).catch(() => {});
}

async function syncOnlineStatus(value: boolean) {
  try {
    if (value) {
      const coords = await getCurrentCoords();
      await setDriverOnlineStatus(true, coords?.lat, coords?.lng);

      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(pushLocationRefresh, REFRESH_INTERVAL_MS);
    } else {
      if (refreshTimer) {
        clearInterval(refreshTimer);
        refreshTimer = null;
      }
      await setDriverOnlineStatus(false);
    }
  } catch {
    // Best-effort — never block the UI toggle on a network hiccup. Worst
    // case, this driver just doesn't receive proximity-based push until
    // the next successful sync.
  }
}

export function getDriverOnline(): boolean {
  return online;
}

export function setDriverOnline(value: boolean): void {
  if (value === online) return;
  online = value;
  listeners.forEach((l) => l(value));
  syncOnlineStatus(value);
}

export function toggleDriverOnline(): void {
  setDriverOnline(!online);
}

export function subscribeDriverOnline(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useDriverOnline(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(online);
  useEffect(() => subscribeDriverOnline(setValue), []);
  return [value, setDriverOnline];
}