import { IS_DRIVER_APP } from "./appConfig";
import { getMyDriverStatus, switchActiveMode } from "./driverApplication";
import { getActiveRideForDriver, getActiveRideForRider } from "./rides";
import { getDriverPresenceOnline } from "./presence";

// profiles.active_mode is still what the server uses to decide whether
// someone is "driving right now" (dispatch pushes, driver/rider event
// pushes, and the legacy push_token routing — see
// 20261006120000_split_apps_push_tokens.sql). In the old single app it
// changed when the user tapped Switch to Rider/Driver. Now that each side
// is its own app, opening an app is the switch: each app claims its own
// mode on launch and whenever it returns to the foreground.
//
// Two guards keep that from doing harm for dual-role accounts:
//   - Never claim while the person has a trip in progress on the other
//     side (a passenger mid-ride opening the driver app, or a driver
//     mid-trip opening the rider app). That would silence the pushes for
//     the trip they're actually on.
//   - The rider app never silently takes an online driver offline — it
//     asks first, since that's what the old Switch to Rider did implicitly
//     and it's no longer an explicit tap.

export type ModeGateState =
  | { kind: "ok" }
  // Driver app only: this account hasn't registered as a driver yet.
  | { kind: "needs_registration" }
  // A trip is in progress on the other side; nothing was changed.
  | { kind: "busy_on_other_side"; rideId: string }
  // Rider app only: still online in the driver app; needs confirmation.
  | { kind: "online_as_driver" };

type Listener = (state: ModeGateState) => void;

let current: ModeGateState = { kind: "ok" };
const listeners = new Set<Listener>();
let inFlight: Promise<ModeGateState> | null = null;

function publish(next: ModeGateState) {
  current = next;
  listeners.forEach((l) => l(next));
}

export function getModeGateState(): ModeGateState {
  return current;
}

export function subscribeModeGate(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

// Clears any gate overlay — called on sign-out.
export function resetModeGate(): void {
  publish({ kind: "ok" });
}

// Makes profiles.active_mode match this app, if that's safe. Concurrent
// calls (login redirect + foreground listener firing together) share one
// round trip. `goOffline: true` is the rider app's explicit confirmation
// that it's fine to take an online driver offline.
export function ensureAppMode(opts: { goOffline?: boolean } = {}): Promise<ModeGateState> {
  if (inFlight && !opts.goOffline) return inFlight;

  const run = claim(!!opts.goOffline)
    .catch((e: any) => {
      // Fail open: a network hiccup here should never lock someone out of
      // the app. Worst case pushes keep routing by the previous mode until
      // the next foreground re-check.
      if (e?.message !== "Not signed in.") {
        console.warn("[appMode] couldn't confirm app mode:", e?.message ?? e);
      }
      return { kind: "ok" } as ModeGateState;
    })
    .then((state) => {
      publish(state);
      return state;
    })
    .finally(() => {
      if (inFlight === run) inFlight = null;
    });

  inFlight = run;
  return run;
}

async function claim(goOffline: boolean): Promise<ModeGateState> {
  const status = await getMyDriverStatus();

  if (IS_DRIVER_APP) {
    if (!status.isDriver) return { kind: "needs_registration" };
    if (status.activeMode === "driver") return { kind: "ok" };

    const riding = await getActiveRideForRider();
    if (riding) return { kind: "busy_on_other_side", rideId: riding.id };

    await switchActiveMode("driver");
    return { kind: "ok" };
  }

  // Rider app. Pure riders stop here after a single profile read.
  if (status.activeMode === "rider") return { kind: "ok" };

  const driving = await getActiveRideForDriver();
  if (driving) return { kind: "busy_on_other_side", rideId: driving.id };

  if (!goOffline) {
    const online = await getDriverPresenceOnline();
    if (online) return { kind: "online_as_driver" };
  }

  // switch_active_mode also forces the driver offline server-side when
  // going driver -> rider.
  await switchActiveMode("rider");
  return { kind: "ok" };
}
