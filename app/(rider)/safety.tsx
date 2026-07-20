import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import PrimaryButton from "../../src/components/PrimaryButton";
import RowItem from "../../src/components/RowItem";
import TextField from "../../src/components/TextField";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import { getCurrentProfile } from "../../src/lib/auth";
import {
  EmergencyContact, SOSAlert,
  getEmergencyContacts, addEmergencyContact, deleteEmergencyContact,
  getMyActiveSOSAlert, triggerSOS, resolveSOS, openSOSTextTo,
} from "../../src/lib/safety";

const CONSENT_TEXT =
  "Turning this on will show your live location to other signed-in riders and drivers nearby, in addition to your emergency contacts, until you mark yourself safe. " +
  "This is meant for situations where you need help fast and don't just want to wait on a private contact to respond. " +
  "Your name and exact identity aren't shown to other users — just an alert marker and your approximate location.";

export default function SafetyScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [activeAlert, setActiveAlert] = useState<SOSAlert | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [addingContact, setAddingContact] = useState(false);

  const [showConsent, setShowConsent] = useState(false);
  const [consentChecked, setConsentChecked] = useState(false);
  const [triggering, setTriggering] = useState(false);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile();
      if (profile) setRole(profile.role);
      const [c, alert] = await Promise.all([getEmergencyContacts(), getMyActiveSOSAlert()]);
      setContacts(c);
      setActiveAlert(alert);
    } catch {
      // keep whatever we had
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(useCallback(() => { load(); }, [load]));

  const handleAddContact = async () => {
    if (!name.trim() || !phone.trim()) {
      Alert.alert("Missing details", "Please enter both a name and phone number.");
      return;
    }
    setAddingContact(true);
    try {
      const contact = await addEmergencyContact(name, phone);
      setContacts((prev) => [...prev, contact]);
      setName("");
      setPhone("");
    } catch (e: any) {
      Alert.alert("Couldn't add contact", e?.message ?? "Please try again.");
    } finally {
      setAddingContact(false);
    }
  };

  const handleDeleteContact = (id: string) => {
    Alert.alert("Remove contact?", "You can add them back any time.", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Remove",
        style: "destructive",
        onPress: async () => {
          try {
            await deleteEmergencyContact(id);
            setContacts((prev) => prev.filter((c) => c.id !== id));
          } catch (e: any) {
            Alert.alert("Couldn't remove contact", e?.message ?? "Please try again.");
          }
        },
      },
    ]);
  };

  const getLocation = async (): Promise<{ lat: number; lng: number } | null> => {
    const { status } = await Location.requestForegroundPermissionsAsync();
    if (status !== "granted") {
      Alert.alert("Location needed", "Location access is needed to share where you are.");
      return null;
    }
    const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
    return { lat: pos.coords.latitude, lng: pos.coords.longitude };
  };

  const handleTrigger = async (shareScope: "emergency_only" | "public") => {
    if (contacts.length === 0 && shareScope === "emergency_only") {
      Alert.alert("Add a contact first", "Add at least one emergency contact so someone can be alerted.");
      return;
    }
    setTriggering(true);
    try {
      const loc = await getLocation();
      if (!loc) return;

      const alert = await triggerSOS({
        shareScope,
        lat: loc.lat,
        lng: loc.lng,
        consentGiven: shareScope === "public",
      });
      setActiveAlert(alert);
      setShowConsent(false);
      setConsentChecked(false);

      // Pre-fill a text to each emergency contact with a maps link. There's
      // no SMS gateway here, so this opens the native composer — the
      // person still has to hit send.
      for (const c of contacts) {
        await openSOSTextTo(c.phone, loc.lat, loc.lng);
      }
    } catch (e: any) {
      Alert.alert("Couldn't send alert", e?.message ?? "Please try again.");
    } finally {
      setTriggering(false);
    }
  };

  const handleResolve = async () => {
    if (!activeAlert) return;
    setResolving(true);
    try {
      await resolveSOS(activeAlert.id);
      setActiveAlert(null);
    } catch (e: any) {
      Alert.alert("Couldn't clear alert", e?.message ?? "Please try again.");
    } finally {
      setResolving(false);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Safety" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}><ActivityIndicator color={COLORS.red} /></View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
      </Screen>
    );
  }

  return (
    <Screen>
      <RiderHeader subtitle="Safety" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        {activeAlert ? (
          <GlassCard style={styles.activeCard}>
            <View style={styles.activeRow}>
              <Ionicons name="alert-circle" size={20} color={COLORS.red} />
              <Text style={styles.activeTitle}>SOS Active</Text>
            </View>
            <Text style={styles.activeSub}>
              {activeAlert.share_scope === "public"
                ? "Your emergency contacts and nearby app users can see your location."
                : "Your emergency contacts can see your location."}
            </Text>
            <PrimaryButton
              label={resolving ? "..." : "I'm Safe Now"}
              onPress={handleResolve}
              disabled={resolving}
            />
          </GlassCard>
        ) : (
          <GlassCard style={{ gap: 10 }}>
            <Text style={styles.kicker}>SOS</Text>
            <Text style={styles.sub}>
              Available any time, but especially useful mid-trip if something feels wrong.
            </Text>
            <PrimaryButton
              label={triggering ? "Sending..." : "Alert Emergency Contacts"}
              onPress={() => handleTrigger("emergency_only")}
              disabled={triggering}
              danger
            />
            <Pressable
              onPress={() => setShowConsent((v) => !v)}
              style={styles.publicToggle}
            >
              <Ionicons name="people-outline" size={15} color={COLORS.textDim} />
              <Text style={styles.publicToggleTxt}>Also alert people nearby with the app</Text>
            </Pressable>

            {showConsent && (
              <View style={styles.consentBox}>
                <Text style={styles.consentText}>{CONSENT_TEXT}</Text>
                <Pressable
                  style={styles.consentCheckRow}
                  onPress={() => setConsentChecked((v) => !v)}
                >
                  <Ionicons
                    name={consentChecked ? "checkbox" : "square-outline"}
                    size={20}
                    color={consentChecked ? COLORS.red : COLORS.textFaint}
                  />
                  <Text style={styles.consentCheckTxt}>
                    I understand and agree to share my location with nearby app users
                  </Text>
                </Pressable>
                <PrimaryButton
                  label={triggering ? "Sending..." : "Agree & Share Publicly"}
                  onPress={() => handleTrigger("public")}
                  disabled={!consentChecked || triggering}
                  danger
                />
              </View>
            )}
          </GlassCard>
        )}

        <Text style={styles.section}>Emergency Contacts</Text>
        {contacts.length === 0 ? (
          <Text style={styles.emptyTxt}>No emergency contacts yet — add one below.</Text>
        ) : (
          contacts.map((c) => (
            <RowItem
              key={c.id}
              icon="person-outline"
              title={c.name}
              subtitle={c.phone}
              showChevron={false}
              onPress={() => handleDeleteContact(c.id)}
            />
          ))
        )}

        <GlassCard style={{ gap: 10 }}>
          <Text style={styles.kicker}>Add a Contact</Text>
          <TextField label="Name" placeholder="e.g. Thandeka" value={name} onChangeText={setName} />
          <TextField label="Phone" placeholder="082 123 4567" value={phone} onChangeText={setPhone} keyboardType="phone-pad" />
          <PrimaryButton
            label={addingContact ? "Adding..." : "Add Contact"}
            onPress={handleAddContact}
            disabled={addingContact}
          />
        </GlassCard>
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role={role} />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  kicker: {
    color: COLORS.textDim, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  sub: { color: COLORS.textDim, fontSize: 13, lineHeight: 18 },
  section: {
    marginTop: SPACE.md, marginBottom: 2, paddingLeft: 4,
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 2,
    textTransform: "uppercase", fontWeight: "800",
  },
  emptyTxt: { color: COLORS.textFaint, fontSize: 13, paddingLeft: 4 },
  activeCard: { gap: 10, borderColor: COLORS.borderRed },
  activeRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  activeTitle: { color: COLORS.red, fontWeight: "900", fontSize: 16 },
  activeSub: { color: COLORS.textDim, fontSize: 13 },
  publicToggle: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: 4 },
  publicToggleTxt: { color: COLORS.textDim, fontSize: 13, fontWeight: "700" },
  consentBox: {
    gap: 10, backgroundColor: "rgba(255,255,255,0.05)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
    borderRadius: RADIUS.md, padding: 12,
  },
  consentText: { color: COLORS.textDim, fontSize: 12, lineHeight: 17 },
  consentCheckRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  consentCheckTxt: { flex: 1, color: COLORS.text, fontSize: 12, fontWeight: "700" },
});