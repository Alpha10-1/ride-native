import { Linking, Platform } from "react-native";
import { supabase } from "./supabase";

export type EmergencyContact = {
  id: string;
  profile_id: string;
  name: string;
  phone: string;
  created_at: string;
};

export type ShareScope = "emergency_only";

export type EmergencyMessageTemplateId = "general" | "unsafe" | "call_me" | "medical" | "custom";

export const EMERGENCY_MESSAGE_TEMPLATES: { id: Exclude<EmergencyMessageTemplateId, "custom">; label: string; body: string }[] = [
  { id: "general", label: "General SOS", body: "I need help. This isn't a drill." },
  { id: "unsafe", label: "I feel unsafe", body: "I don't feel safe right now. Please check in with me." },
  { id: "call_me", label: "Please call me", body: "I need you to call me right now — it's urgent." },
  { id: "medical", label: "Medical emergency", body: "This is a medical emergency. I need help immediately." },
];

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
  messageTemplate?: EmergencyMessageTemplateId;
  messageBody?: string;
  contactsNotified?: number;
}): Promise<SOSAlert> {
  const { data, error } = await supabase.rpc("trigger_sos", {
    share_scope_in: params.shareScope,
    lat_in: params.lat,
    lng_in: params.lng,
    ride_id_in: params.rideId ?? null,
    consent_given_in: false,
  });
  if (error) throw error;
  const alert = data as SOSAlert;

  // Best-effort — an admin dashboard being able to see what was sent and to
  // whom matters, but shouldn't block the alert itself from going through
  // if this secondary call fails for any reason.
  if (params.messageTemplate || params.messageBody || params.contactsNotified !== undefined) {
    try {
      await recordSOSDetails(alert.id, params.messageTemplate ?? null, params.messageBody ?? null, params.contactsNotified ?? null);
    } catch {
      // non-critical
    }
  }

  return alert;
}

// Attaches the message that was actually sent and how many contacts were
// notified to an SOS event, so it shows up as more than a bare marker in
// the admin dashboard.
export async function recordSOSDetails(
  alertId: string,
  messageTemplate: string | null,
  messageBody: string | null,
  contactsNotified: number | null
): Promise<SOSAlert> {
  const { data, error } = await supabase.rpc("record_sos_details", {
    alert_id_in: alertId,
    message_template_in: messageTemplate,
    message_body_in: messageBody,
    contacts_notified_in: contactsNotified,
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

// Nearby-app-user alerting has been intentionally removed — SOS alerts
// only ever reach the person's own emergency contacts. See the
// safety-updates migration for the DB-level constraint backing this up.

// Opens the native SMS composer, pre-filled with an alert message and a
// Google Maps link to the given coordinates. There's no SMS gateway in
// this project, so the message is sent from the user's own phone/number —
// this only prepares it; the person still has to hit send.
export async function openSOSTextTo(phone: string, lat: number, lng: number, messageBody?: string) {
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `${messageBody ?? "SOS: I need help."} My current location: ${mapsUrl}`;
  const separator = Platform.OS === "ios" ? "&" : "?";
  const url = `sms:${phone}${separator}body=${encodeURIComponent(message)}`;
  try {
    await Linking.openURL(url);
  } catch {
    // Best-effort — if the device has no SMS app, there's nothing more we can do here.
  }
}

// Normalizes a South African-style local number ("082 123 4567") to the
// international format WhatsApp's click-to-chat links require (no spaces,
// no leading 0, country code prefixed). Numbers that already look
// international (start with a country code, no leading 0) pass through.
function toWhatsAppNumber(phone: string): string {
  const digits = phone.replace(/\D/g, "");
  if (digits.startsWith("0")) return `27${digits.slice(1)}`;
  return digits;
}

// Opens WhatsApp's click-to-chat link, pre-filled the same way as the SMS
// alert. Falls back silently if WhatsApp isn't installed — the SMS alert
// (or the in-app alert record itself) still goes out regardless.
export async function openSOSWhatsAppTo(phone: string, lat: number, lng: number, messageBody?: string) {
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `${messageBody ?? "SOS: I need help."} My current location: ${mapsUrl}`;
  const number = toWhatsAppNumber(phone);
  const url = `whatsapp://send?phone=${number}&text=${encodeURIComponent(message)}`;
  try {
    const canOpen = await Linking.canOpenURL(url);
    if (canOpen) await Linking.openURL(url);
  } catch {
    // Best-effort — WhatsApp not installed or not registered as a URL scheme handler.
  }
}

// Prefers WhatsApp (near-universal in South Africa, no per-message carrier
// cost) and only falls back to SMS if WhatsApp isn't installed — firing
// both unconditionally would just yank the user out of the first composer
// into the second before they could hit send.
export async function alertEmergencyContact(phone: string, lat: number, lng: number, messageBody?: string) {
  const mapsUrl = `https://maps.google.com/?q=${lat},${lng}`;
  const message = `${messageBody ?? "SOS: I need help."} My current location: ${mapsUrl}`;
  const number = toWhatsAppNumber(phone);
  const whatsappUrl = `whatsapp://send?phone=${number}&text=${encodeURIComponent(message)}`;

  try {
    const canOpenWhatsApp = await Linking.canOpenURL(whatsappUrl);
    if (canOpenWhatsApp) {
      await Linking.openURL(whatsappUrl);
      return;
    }
  } catch {
    // fall through to SMS
  }

  await openSOSTextTo(phone, lat, lng, messageBody);
}