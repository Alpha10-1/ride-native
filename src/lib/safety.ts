import { Linking, Platform } from "react-native";
import { supabase } from "./supabase";

export type EmergencyContact = {
  id: string;
  profile_id: string;
  name: string;
  phone: string;
  created_at: string;
};

export type ShareScope = "emergency_only" | "public";

export type SOSAlert = {
  id: string;
  user_id: string;
  user_role: "rider" | "driver";
  ride_id: string | null;
  share_scope: ShareScope;
  lat: number;
  lng: number;
  status: "active" | "resolved";
  public_consent_at: string | null;
  created_at: string;
  resolved_at: string | null;
};

// ============================================
// EMERGENCY CONTACTS
// ============================================
export async function getEmergencyContacts(): Promise<EmergencyContact[]> {
  const { data, error } = await supabase
    .from("emergency_contacts")
    .select("*")
    .order("created_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as EmergencyContact[];
}

export async function addEmergencyContact(name: string, phone: string): Promise<EmergencyContact> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) throw new Error("Not signed in.");

  const { data, error } = await supabase
    .from("emergency_contacts")
    .insert({ profile_id: userId, name: name.trim(), phone: phone.trim() })
    .select()
    .single();
  if (error) throw error;
  return data as EmergencyContact;
}

export async function deleteEmergencyContact(id: string): Promise<void> {
  const { error } = await supabase.from("emergency_contacts").delete().eq("id", id);
  if (error) throw error;
}

// ============================================
// SOS ALERTS
// ============================================
export async function triggerSOS(params: {
  shareScope: ShareScope;
  lat: number;
  lng: number;
  rideId?: string;
  consentGiven?: boolean;
}): Promise<SOSAlert> {
  const { data, error } = await supabase.rpc("trigger_sos", {
    share_scope_in: params.shareScope,
    lat_in: params.lat,
    lng_in: params.lng,
    ride_id_in: params.rideId ?? null,
    consent_given_in: params.consentGiven ?? false,
  });
  if (error) throw error;
  return data as SOSAlert;
}

export async function resolveSOS(alertId: string): Promise<SOSAlert> {
  const { data, error } = await supabase.rpc("resolve_sos", { alert_id_in: alertId });
  if (error) throw error;
  return data as SOSAlert;
}

export async function getMyActiveSOSAlert(): Promise<SOSAlert | null> {
  const { data: session } = await supabase.auth.getSession();
  const userId = session.session?.user.id;
  if (!userId) return null;

  const { data, error } = await supabase
    .from("sos_alerts")
    .select("*")
    .eq("user_id", userId)
    .eq("status", "active")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function getNearbyPublicAlerts(
  lat: number,
  lng: number,
  radiusKm = 3
): Promise<SOSAlert[]> {
  const { data, error } = await supabase.rpc("get_nearby_public_sos_alerts", {
    lat_in: lat,
    lng_in: lng,
    radius_km_in: radiusKm,
  });
  if (error) throw error;
  return (data ?? []) as SOSAlert[];
}

// Opens the native SMS composer, pre-filled with an alert message and a
// Google Maps link to the given coordinates. There's no SMS gateway in
// this project, so the message is sent from the user's own phone/number —
// this only prepares it; the person still has to hit send.
export async function openSOSTextTo(phone: string, lat: number, lng: number) {
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `SOS: I need help. My current location: ${mapsUrl}`;
  const separator = Platform.OS === "ios" ? "&" : "?";
  const url = `sms:${phone}${separator}body=${encodeURIComponent(message)}`;
  try {
    await Linking.openURL(url);
  } catch {
    // Best-effort — if the device has no SMS app, there's nothing more we can do here.
  }
}