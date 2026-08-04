import { supabase } from "./supabase";
import { resetTo } from "./navigation";
import { Alert } from "react-native";
import { registerAndSavePushToken } from "./pushNotifications";

// Supabase Auth requires an email. Since this app authenticates by username,
// we synthesize an internal address the user never sees or types.
function usernameToAuthEmail(username: string) {
  return `${username.trim().toLowerCase()}@ridenative.internal`;
}

export type Role = "rider" | "driver";

// Username requirements — enforced both here (instant feedback while
// typing) and, for length/uniqueness, implicitly by the DB via
// is_username_available.
export const USERNAME_MIN_LENGTH = 4;
export const USERNAME_MAX_LENGTH = 20;
export const USERNAME_REQUIREMENTS =
  `${USERNAME_MIN_LENGTH}-${USERNAME_MAX_LENGTH} characters. Start with a letter. ` +
  `Lowercase letters, numbers, underscores, and periods only.`;

// Returns null if the format is valid, or a human-readable reason if not.
// Doesn't check availability — see checkUsernameAvailable for that.
export function validateUsernameFormat(usernameRaw: string): string | null {
  const username = usernameRaw.trim().toLowerCase();
  if (username.length < USERNAME_MIN_LENGTH) {
    return `Must be at least ${USERNAME_MIN_LENGTH} characters.`;
  }
  if (username.length > USERNAME_MAX_LENGTH) {
    return `Must be at most ${USERNAME_MAX_LENGTH} characters.`;
  }
  if (!/^[a-z]/.test(username)) {
    return "Must start with a letter.";
  }
  if (!/^[a-z0-9_.]+$/.test(username)) {
    return "Only lowercase letters, numbers, underscores, and periods are allowed.";
  }
  return null;
}

export type RegisterPayload = {
  username: string;
  password: string;
  firstName: string;
  lastName: string;
  email: string;
  cellphone: string;
  dateOfBirth: string; // ISO format YYYY-MM-DD
  role: Role;
  // driver-only
  driverLicenseNumber?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  licensePlate?: string;
};

export async function checkUsernameAvailable(username: string) {
  const { data, error } = await supabase.rpc("is_username_available", {
    check_username: username.trim().toLowerCase(),
  });
  if (error) throw error;
  return data as boolean;
}

export async function registerUser(payload: RegisterPayload) {
  const authEmail = usernameToAuthEmail(payload.username);

  // 1. Create the auth user
  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email: authEmail,
    password: payload.password,
  });

  if (signUpError) throw signUpError;

  const user = signUpData.user;
  if (!user) {
    throw new Error("Sign up succeeded but no user was returned.");
  }

  // 2. Insert the profile row
  const { error: profileError } = await supabase.from("profiles").insert({
    id: user.id,
    username: payload.username.trim().toLowerCase(),
    first_name: payload.firstName.trim(),
    last_name: payload.lastName.trim(),
    email: payload.email.trim().toLowerCase(),
    cellphone: payload.cellphone.trim(),
    date_of_birth: payload.dateOfBirth,
    role: payload.role,
    driver_license_number: payload.role === "driver" ? payload.driverLicenseNumber : null,
    vehicle_make: payload.role === "driver" ? payload.vehicleMake : null,
    vehicle_model: payload.role === "driver" ? payload.vehicleModel : null,
    license_plate: payload.role === "driver" ? payload.licensePlate : null,
    // Signing up directly as a driver already provides everything the
    // later "Apply to drive" flow collects, so this account shouldn't
    // need to go through that separately — see is_driver/active_mode in
    // 20260803120000_dual_role_driver_apply.sql.
    is_driver: payload.role === "driver",
    active_mode: payload.role,
    agreed_to_terms: true,
  });

  if (profileError) {
    // Profile insert failed after auth user was created.
    // Surface a clear error so the UI can tell the user what happened.
    throw new Error(
      `Account created but profile setup failed: ${profileError.message}`
    );
  }

  // Best-effort — links their real email as a verified Supabase Auth
  // identity so account recovery (forgot username/password) works later.
  // Supabase emails a confirmation link to the real address using its own
  // built-in mailer; nothing else here depends on it succeeding.
  linkRecoveryEmail(payload.email).catch(() => {});

  return user;
}

// Sends a confirmation link to the person's real email, which — once
// clicked — replaces their synthetic auth email with this real one. Safe
// to call again later (e.g. from a "resend verification" button) if the
// first email is missed or the address changes.
export async function linkRecoveryEmail(realEmail: string) {
  const { error } = await supabase.auth.updateUser({ email: realEmail.trim().toLowerCase() });
  if (error) throw error;
}

export async function loginUser(username: string, password: string) {
  const trimmedUsername = username.trim().toLowerCase();
  let authEmail = usernameToAuthEmail(trimmedUsername);

  // Once someone has verified a real recovery email (see linkRecoveryEmail),
  // their Supabase Auth email changes from the synthetic placeholder to
  // that real address, so we can't always assume the synthetic form.
  try {
    const { data: resolvedEmail } = await supabase.rpc("get_auth_email_for_username", {
      username_in: trimmedUsername,
    });
    if (resolvedEmail) authEmail = resolvedEmail;
  } catch {
    // Fall back to the synthetic guess below — worst case this only
    // affects accounts that have already verified a real email, and
    // they'll just see a sign-in error to retry rather than a crash.
  }

  const { data, error } = await supabase.auth.signInWithPassword({
    email: authEmail,
    password,
  });

  if (error) {
    // Supabase's default error message mentions "email" which would confuse
    // users who only ever see "username" in this app.
    if (error.message.toLowerCase().includes("invalid login credentials")) {
      throw new Error("Incorrect username or password.");
    }
    throw error;
  }

  return data.user;
}

export async function getCurrentProfile() {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("profiles")
    .select("*")
    .eq("id", userId)
    .single();

  if (error) throw error;
  return data;
}

export type ProfileUpdatePayload = {
  firstName?: string;
  lastName?: string;
  email?: string;
  cellphone?: string;
  // driver-only
  driverLicenseNumber?: string;
  vehicleMake?: string;
  vehicleModel?: string;
  licensePlate?: string;
};

export async function updateProfile(payload: ProfileUpdatePayload) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const updates: Record<string, any> = {};
  if (payload.firstName !== undefined) updates.first_name = payload.firstName.trim();
  if (payload.lastName !== undefined) updates.last_name = payload.lastName.trim();
  if (payload.email !== undefined) updates.email = payload.email.trim().toLowerCase();
  if (payload.cellphone !== undefined) updates.cellphone = payload.cellphone.trim();
  if (payload.driverLicenseNumber !== undefined) updates.driver_license_number = payload.driverLicenseNumber.trim();
  if (payload.vehicleMake !== undefined) updates.vehicle_make = payload.vehicleMake.trim();
  if (payload.vehicleModel !== undefined) updates.vehicle_model = payload.vehicleModel.trim();
  if (payload.licensePlate !== undefined) updates.license_plate = payload.licensePlate.trim();

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Uploads a picked image (local file uri) as the signed-in user's profile
// photo, to the public avatars bucket, then saves the resulting public
// URL onto their profile row. Shared by both rider and driver profile
// screens (ProfileScreen.tsx). upsert:true + a fixed filename means
// re-uploading just replaces the old photo in place — no orphaned files
// to worry about, beyond the timestamp query param appended below to
// bust any cached copy of the old image at that same URL.
export async function uploadAvatar(localUri: string): Promise<string> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const ext = localUri.split(".").pop()?.split("?")[0] || "jpg";
  const path = `${userId}/avatar.${ext}`;

  const response = await fetch(localUri);
  const arrayBuffer = await response.arrayBuffer();

  const { error: uploadError } = await supabase.storage
    .from("avatars")
    .upload(path, arrayBuffer, {
      contentType: response.headers.get("content-type") ?? "image/jpeg",
      upsert: true,
    });
  if (uploadError) throw uploadError;

  const { data: publicUrlData } = supabase.storage.from("avatars").getPublicUrl(path);
  const avatarUrl = `${publicUrlData.publicUrl}?t=${Date.now()}`;

  const { error: updateError } = await supabase
    .from("profiles")
    .update({ avatar_url: avatarUrl })
    .eq("id", userId);
  if (updateError) throw updateError;

  return avatarUrl;
}

export type Language = "en" | "af" | "zu" | "xh";

export async function updatePreferences(payload: {
  notifyPush?: boolean;
  notifySms?: boolean;
  language?: Language;
}) {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const updates: Record<string, any> = {};
  if (payload.notifyPush !== undefined) updates.notify_push = payload.notifyPush;
  if (payload.notifySms !== undefined) updates.notify_sms = payload.notifySms;
  if (payload.language !== undefined) updates.language = payload.language;

  const { data, error } = await supabase
    .from("profiles")
    .update(updates)
    .eq("id", userId)
    .select()
    .single();

  if (error) throw error;
  return data;
}

// Permanently deletes the current user's account and all associated data
// (profile, wallet, saved places, redeemed promotions cascade automatically
// via foreign key constraints). This cannot be undone.
export async function redirectAfterAuth() {
  try {
    const profile = await getCurrentProfile();
    if (!profile) {
      resetTo("/auth/login");
      return;
    }
    if (profile.is_suspended) {
      await supabase.auth.signOut();
      Alert.alert(
        "Account suspended",
        profile.suspension_reason
          ? `Your account has been suspended: ${profile.suspension_reason}`
          : "Your account has been suspended. Contact support for details."
      );
      resetTo("/auth/login");
      return;
    }
    if (profile.role === "staff") {
      await supabase.auth.signOut();
      Alert.alert(
        "Staff account",
        "This account is for the admin dashboard, not the rider/driver app."
      );
      resetTo("/auth/login");
      return;
    }
    // Fire-and-forget — push setup should never hold up or break sign-in.
    registerAndSavePushToken().catch(() => {});
    // active_mode (not role) decides which side of the app to land on —
    // a dual-registered account's role reflects how they originally
    // signed up, not which mode they last used. Fall back to role for
    // any row that somehow predates the active_mode column.
    const mode = profile.active_mode ?? profile.role;
    resetTo(mode === "driver" ? "/(driver)/home" : "/(rider)/home");
  } catch {
    // Profile fetch failed — fall back to manual role picker
    resetTo("/auth/role");
  }
}

export async function deleteAccount() {
  const { error } = await supabase.rpc("delete_own_account");
  if (error) throw error;

  // The auth user no longer exists server-side at this point. Modern
  // supabase-js versions handle this gracefully and still clear local
  // session storage, but we swallow any error here defensively since the
  // account is already deleted regardless of whether this call succeeds.
  try {
    await supabase.auth.signOut();
  } catch {
    // ignore: local session cleanup is best-effort once the account is gone
  }
}

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

// ============================================
// ACCOUNT RECOVERY
// ============================================
// Both flows below only work for an account that has verified a real
// recovery email (see linkRecoveryEmail) — Supabase's built-in email
// delivery has no way to reach anyone still on the synthetic placeholder
// address. Deliberately generic success messages throughout so neither
// flow ever confirms/denies whether a given email has an account.

const PASSWORD_RESET_REDIRECT_URL = "ridenative://auth/reset-password";

// Step 1 of "forgot password" — sends a reset link to the given email if
// (and only if) it's a verified recovery email on some account. Always
// resolves; the UI should show the same message regardless of outcome.
export async function requestPasswordReset(email: string) {
  await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
    redirectTo: PASSWORD_RESET_REDIRECT_URL,
  });
}

// Step 2 — called from the reset-password screen once a recovery session
// has been established via the emailed link (see exchangeRecoverySession).
export async function completePasswordReset(newPassword: string) {
  const { error } = await supabase.auth.updateUser({ password: newPassword });
  if (error) throw error;
}

// Establishes a session from the recovery link's URL (opened via the
// ridenative:// deep link). Supports both the modern PKCE `?code=` link
// format and, as a fallback, the older `#access_token=` implicit format.
export async function exchangeRecoverySession(url: string) {
  if (url.includes("code=")) {
    const { error } = await supabase.auth.exchangeCodeForSession(url);
    if (error) throw error;
    return;
  }

  const fragment = url.split("#")[1] ?? "";
  const params = new URLSearchParams(fragment);
  const access_token = params.get("access_token");
  const refresh_token = params.get("refresh_token");
  if (!access_token || !refresh_token) {
    throw new Error("This reset link is missing or invalid. Please request a new one.");
  }
  const { error } = await supabase.auth.setSession({ access_token, refresh_token });
  if (error) throw error;
}

// "Forgot username" step 1 — sends a one-time code to the given email if
// it's a verified recovery email on some account. shouldCreateUser: false
// so this can never accidentally create a new blank account.
export async function requestUsernameRecoveryOtp(email: string) {
  await supabase.auth.signInWithOtp({
    email: email.trim().toLowerCase(),
    options: { shouldCreateUser: false },
  });
}

// Step 2 — verifying the code signs them in, so we can read their profile
// straight away. Signs back out immediately after reading the username,
// since "forgot username" shouldn't silently leave someone logged in on a
// shared device.
export async function verifyUsernameRecoveryOtp(email: string, token: string): Promise<string> {
  const { error } = await supabase.auth.verifyOtp({
    email: email.trim().toLowerCase(),
    token: token.trim(),
    type: "email",
  });
  if (error) throw error;

  const profile = await getCurrentProfile();
  await supabase.auth.signOut();

  if (!profile?.username) {
    throw new Error("Couldn't find a username for this account.");
  }
  return profile.username;
}