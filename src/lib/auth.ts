import { supabase } from "./supabase";

// Supabase Auth requires an email. Since this app authenticates by username,
// we synthesize an internal address the user never sees or types.
function usernameToAuthEmail(username: string) {
  return `${username.trim().toLowerCase()}@ridenative.internal`;
}

export type Role = "rider" | "driver";

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
    agreed_to_terms: true,
  });

  if (profileError) {
    // Profile insert failed after auth user was created.
    // Surface a clear error so the UI can tell the user what happened.
    throw new Error(
      `Account created but profile setup failed: ${profileError.message}`
    );
  }

  return user;
}

export async function loginUser(username: string, password: string) {
  const authEmail = usernameToAuthEmail(username);

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

export async function logout() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}