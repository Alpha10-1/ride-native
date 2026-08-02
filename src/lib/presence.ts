import { supabase } from "./supabase";

// Driver-only: the Go Online/Offline toggle. Also stamps a location when
// going online so proximity-based push (new requests) has something fresh
// to match against immediately, not just after the first periodic ping.
export async function setDriverOnlineStatus(
  online: boolean,
  lat?: number,
  lng?: number
): Promise<void> {
  const { error } = await supabase.rpc("set_driver_online", {
    online_in: online,
    lat_in: lat ?? null,
    lng_in: lng ?? null,
  });
  if (error) throw error;
}

// Same as above, but for going online specifically: routes through
// go_online_checked (see 20260730120000_driver_subscriptions.sql), which
// verifies the driver's subscription is active/in-grace before calling
// set_driver_online itself. Throws with a human-readable reason if the
// subscription isn't in good standing — callers should surface that
// message rather than swallow it, unlike the location-refresh calls
// elsewhere in this file.
export async function setDriverOnlineChecked(lat?: number, lng?: number): Promise<void> {
  const { error } = await supabase.rpc("go_online_checked", {
    lat_in: lat ?? null,
    lng_in: lng ?? null,
  });
  if (error) throw error;
}

// Generic presence ping — any signed-in user (rider or driver). Purely so
// proximity pushes (new ride requests to nearby drivers) have a recent
// location to work from.
export async function updateMyLocation(lat: number, lng: number): Promise<void> {
  const { error } = await supabase.rpc("update_my_location", {
    lat_in: lat,
    lng_in: lng,
  });
  if (error) throw error;
}