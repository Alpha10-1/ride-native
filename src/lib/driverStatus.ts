import { useEffect, useState } from "react";
import * as Location from "expo-location";

import { setDriverOnlineStatus, setDriverOnlineChecked, updateMyLocation } from "./presence";
import { getMySubscriptionGate } from "./subscription";

// Shared online/offline state across screens (Home, Requests, etc.), now
// backed by the DB (see 0012_driver_presence_and_nearby_push.sql) so
// nearby-driver push for new ride requests actually has something to
// match against. The in-memory flag here still exists so the UI doesn't
// need to wait on a network round-trip just to flip the switch visually —
// the DB sync happens alongside it, best-effort.
//
// Going online specifically is also gated by the driver's subscription
// status (see 20260730120000_driver_subscriptions.sql): setDriverOnline
// optimistically flips the UI immediately like before, but if the
// server-side go_online_checked RPC then rejects it (subscription
// inactive/blocked), the flag is rolled back and subscribeSubscriptionBlocked
// listeners are notified with the reason so the UI can explain why — this
// covers both the normal "not paid up" case and a modified client trying
// to skip the app's own pre-check.

type Listener = (online: boolean) => void;
type BlockedListener = (reason: string) => void;

let online = false;
const listeners = new Set<Listener>();
const blockedListeners = new Set<BlockedListener>();
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

function revertToOffline(reason: string) {
  online = false;
  listeners.forEach((l) => l(false));
  blockedListeners.forEach((l) => l(reason));
  if (refreshTimer) {
    clearInterval(refreshTimer);
    refreshTimer = null;
  }
  setDriverOnlineStatus(false).catch(() => {});
}

async function pushLocationRefresh() {
  const coords = await getCurrentCoords();
  if (!coords) return;
  updateMyLocation(coords.lat, coords.lng).catch(() => {});

  // Also re-check the subscription gate while online, so a driver whose
  // grace period expires (or whose retry charge fails) mid-shift gets
  // taken offline promptly rather than staying online until their next
  // manual toggle.
  try {
    const gate = await getMySubscriptionGate();
    if (!gate.allowed && online) {
      revertToOffline(gate.reason ?? "Your driver subscription is no longer active.");
    }
  } catch {
    // best-effort — never force someone offline over a network hiccup
  }
}

async function syncOnlineStatus(value: boolean) {
  if (value) {
    try {
      const coords = await getCurrentCoords();
      await setDriverOnlineChecked(coords?.lat, coords?.lng);

      if (refreshTimer) clearInterval(refreshTimer);
      refreshTimer = setInterval(pushLocationRefresh, REFRESH_INTERVAL_MS);
    } catch (e: any) {
      // Subscription gate rejected it (or the RPC call itself failed) —
      // unlike the best-effort paths elsewhere in this file, this one
      // needs to actually revert the optimistic UI flip so the driver
      // isn't shown as "online" when the server never accepted it.
      revertToOffline(e?.message ?? "Couldn't go online. Please try again.");
    }
  } else {
    if (refreshTimer) {
      clearInterval(refreshTimer);
      refreshTimer = null;
    }
    try {
      await setDriverOnlineStatus(false);
    } catch {
      // Best-effort — never block the UI toggle on a network hiccup.
    }
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

// Fires whenever going online is rejected by the subscription gate, or
// an already-online driver gets force-taken-offline mid-shift for the
// same reason. Screens can subscribe to this to show why, instead of the
// toggle just silently reverting.
export function subscribeSubscriptionBlocked(listener: BlockedListener): () => void {
  blockedListeners.add(listener);
  return () => blockedListeners.delete(listener);
}

export function useDriverOnline(): [boolean, (value: boolean) => void] {
  const [value, setValue] = useState(online);
  useEffect(() => subscribeDriverOnline(setValue), []);
  return [value, setDriverOnline];
}
