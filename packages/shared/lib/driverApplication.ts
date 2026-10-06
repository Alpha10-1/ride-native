import { router } from "expo-router";
import { supabase } from "./supabase";
import { setDriverOnline } from "./driverStatus";
import { resetTo } from "./navigation";
import { IS_DRIVER_APP } from "./appConfig";
import { openCounterpartApp } from "./counterpartApp";

export type ActiveMode = "rider" | "driver";

export type DriverStatus = {
  isDriver: boolean;
  activeMode: ActiveMode;
  verificationStatus: "unverified" | "pending" | "verified" | "rejected";
};

export async function getMyDriverStatus(): Promise<DriverStatus> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("profiles")
    .select("is_driver, active_mode, verification_status")
    .eq("id", userId)
    .single();
  if (error) throw error;
  return {
    isDriver: !!data.is_driver,
    activeMode: (data.active_mode ?? "rider") as ActiveMode,
    verificationStatus: data.verification_status ?? "unverified",
  };
}

export type DriverRegistrationPayload = {
  licenseNumber: string;
  vehicleMake: string;
  vehicleModel: string;
  licensePlate: string;
};

// Submits the basic driver registration details. Server-side this also
// flips is_driver=true and active_mode='driver' — see
// submit_driver_registration in 20260803120000_dual_role_driver_apply.sql.
export async function submitDriverRegistration(payload: DriverRegistrationPayload) {
  const { data, error } = await supabase.rpc("submit_driver_registration", {
    license_number_in: payload.licenseNumber,
    vehicle_make_in: payload.vehicleMake,
    vehicle_model_in: payload.vehicleModel,
    license_plate_in: payload.licensePlate,
  });
  if (error) throw error;

  // The local online/offline flag (src/lib/driverStatus.ts) has no
  // reason to be true here — this is a brand new driver registration —
  // but reset it defensively in case of stale in-memory state from a
  // previous session, so nothing shows them online before they've ever
  // gone online.
  setDriverOnline(false);
  return data;
}

// Switches which side of the app the signed-in user is using. Throws
// with message "DRIVER_NOT_REGISTERED" if mode is 'driver' and they
// haven't completed registration yet — callers should catch that
// specifically and route into the registration flow instead of just
// showing a generic error (see applyToDrive below for the banner's own
// handling of this).
export async function switchActiveMode(mode: ActiveMode): Promise<void> {
  const { error } = await supabase.rpc("switch_active_mode", { mode_in: mode });
  if (error) {
    if (error.message?.includes("DRIVER_NOT_REGISTERED")) {
      throw new Error("DRIVER_NOT_REGISTERED");
    }
    throw error;
  }
  // The RPC already force-offlines server-side on driver -> rider, but
  // sync the local in-memory flag (src/lib/driverStatus.ts) too so any
  // currently-mounted driver screen's UI updates immediately instead of
  // only catching up on its next poll.
  if (mode === "rider") {
    setDriverOnline(false);
  }
}

// Handler for the "Become a Driver" / Apply banner. Driving lives in the
// separate driver app now, so from the rider app this hands off to it
// (or its store listing). The driver app sends unregistered accounts
// straight into registration on sign-in (redirectAfterAuth), so the
// product requirement still holds: applying with no driver info on file
// immediately starts registration rather than just showing a message.
//
// Inside the driver app this keeps the original behavior: registration
// if needed, otherwise switch to driver mode and go to driver home.
export async function applyToDrive(): Promise<void> {
  if (!IS_DRIVER_APP) {
    await openCounterpartApp();
    return;
  }
  const status = await getMyDriverStatus();
  if (!status.isDriver) {
    router.push("/driver-registration");
    return;
  }
  await switchActiveMode("driver");
  resetTo("/(driver)/home");
}
