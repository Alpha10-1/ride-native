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

  // Additive: keeps driver_notification_presence in sync so the
  // rides_notify_new_ride_request trigger (20260803150000) has
  // something to match nearby drivers against. Best-effort — this is a
  // notification nicety, never something that should block actually
  // going online/offline.
  try {
    if (online && lat != null && lng != null) {
      await supabase.rpc("ping_driver_notification_location", {
        lat_in: lat,
        lng_in: lng,
        online_in: true,
      });
    } else if (!online) {
      await supabase.rpc("set_driver_notification_offline");
    }
  } catch {
    // best-effort, ignore
  }
}

// Same as above, but for going online specifically: routes through
// go_online_test_checked (see 20260804120000_driver_test_mode.sql),
// which itself wraps go_online_checked (20260730120000_driver_subscriptions.sql)
// — so this still verifies the subscription is active/in-grace, and
// additionally verifies the driver isn't in test mode with "go online"
// unchecked. For a driver not in test mode, the test-mode check is a
// pure passthrough, so this is safe to call unconditionally.
//
// Bug fix: this used to call go_online_checked directly, which skipped
// the test-mode check entirely — a driver an admin had locked out of
// going online via the dashboard could still go fully online, making
// Test Mode's main safeguard silently do nothing.
export async function setDriverOnlineChecked(lat?: number, lng?: number): Promise<void> {
  const { error } = await supabase.rpc("go_online_test_checked", {
    lat_in: lat ?? null,
    lng_in: lng ?? null,
  });
  if (error) throw error;
}

// Reads back the driver's actual server-side online flag.
// driver_notification_presence.online is kept in sync by both
// setDriverOnlineStatus (via ping_driver_notification_location /
// set_driver_notification_offline above) and go_online_test_checked, so
// it's the closest thing to a single source of truth this client can
// read directly (RLS: "drivers manage own notification presence" scopes
// this to the caller's own row).
//
// Needed because src/lib/driverStatus.ts's `online` flag is in-memory
// only and always initializes to `false` on a fresh JS process — a real
// app relaunch, or an uncaught-exception crash-and-relaunch, silently
// shows the driver as "Offline" in the UI even if the server still has
// them online. Returns null (rather than throwing) if there's no row
// yet or the read fails, so callers can treat "unknown" the same as
// "don't touch the current UI state".
export async function getDriverPresenceOnline(): Promise<boolean | null> {
  const { data: session } = await supabase.auth.getSession();
  const driverId = session.session?.user.id;
  if (!driverId) return null;

  const { data, error } = await supabase
    .from("driver_notification_presence")
    .select("online")
    .eq("driver_id", driverId)
    .maybeSingle();
  if (error || !data) return null;
  return !!data.online;
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

  // Keep driver_notification_presence fresh too — the matching trigger
  // only considers pings from the last 15 minutes (20260803150000), so
  // an online driver who never calls this again after their initial Go
  // Online tap would silently stop being matchable. Harmless (and a
  // no-op update) for riders calling this too, and best-effort either
  // way — never worth failing a location update over.
  try {
    await supabase.rpc("ping_driver_notification_location", {
      lat_in: lat,
      lng_in: lng,
      online_in: true,
    });
  } catch {
    // best-effort, ignore
  }
}