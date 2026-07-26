import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Location from "expo-location";
import { useFocusEffect } from "expo-router";

import Screen from "../components/Screen";
import RiderHeader from "../components/RiderHeader";
import SideMenuDrawer from "../components/SideMenuDrawer";
import GlassCard from "../components/GlassCard";
import PrimaryButton from "../components/PrimaryButton";
import RowItem from "../components/RowItem";
import TextField from "../components/TextField";
import { COLORS, SPACE, RADIUS } from "../theme/tokens";
import { getCurrentProfile } from "../lib/auth";
import {
  EmergencyContact, SOSAlert, EmergencyMessageTemplateId, EMERGENCY_MESSAGE_TEMPLATES,
  getEmergencyContacts, addEmergencyContact, deleteEmergencyContact,
  getMyActiveSOSAlert, triggerSOS, resolveSOS, alertEmergencyContact,
} from "../lib/safety";

export default function SafetyScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [role, setRole] = useState<"rider" | "driver">("rider");
  const [loading, setLoading] = useState(true);
  const [contacts, setContacts] = useState<EmergencyContact[]>([]);
  const [activeAlert, setActiveAlert] = useState<SOSAlert | null>(null);

  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [addingContact, setAddingContact] = useState(false);

  const [showOptions, setShowOptions] = useState(false);
  const [selectedContactIds, setSelectedContactIds] = useState<Set<string>>(new Set());
  const [templateId, setTemplateId] = useState<EmergencyMessageTemplateId>("general");
  const [customMessage, setCustomMessage] = useState("");
  const [triggering, setTriggering] = useState(false);
  const [resolving, setResolving] = useState(false);

  const load = useCallback(async () => {
    try {
      const profile = await getCurrentProfile();
      if (profile) setRole(profile.role);
      const [c, alert] = await Promise.all([getEmergencyContacts(), getMyActiveSOSAlert()]);
      setContacts(c);
      setActiveAlert(alert);
      setSelectedContactIds((prev) => (prev.size === 0 ? new Set(c.map((x) => x.id)) : prev));
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
      setSelectedContactIds((prev) => new Set(prev).add(contact.id));
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
            setSelectedContactIds((prev) => {
              const next = new Set(prev);
              next.delete(id);
              return next;
            });
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

  const toggleContact = (id: string) => {
    setSelectedContactIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const resolvedMessage = (): string => {
    if (templateId === "custom") return customMessage.trim() || "I need help.";
    return EMERGENCY_MESSAGE_TEMPLATES.find((t) => t.id === templateId)?.body ?? "I need help.";
  };

  const handleTrigger = async () => {
    const toAlert = contacts.filter((c) => selectedContactIds.has(c.id));
    if (toAlert.length === 0) {
      Alert.alert("Select a contact", "Choose at least one emergency contact to alert, or add one below.");
      return;
    }
    if (templateId === "custom" && !customMessage.trim()) {
      Alert.alert("Write a message", "Enter what you'd like your contacts to see, or pick one of the templates.");
      return;
    }
    setTriggering(true);
    try {
      const loc = await getLocation();
      if (!loc) return;

      const messageBody = resolvedMessage();
      const alert = await triggerSOS({
        shareScope: "emergency_only",
        lat: loc.lat,
        lng: loc.lng,
        messageTemplate: templateId,
        messageBody,
        contactsNotified: toAlert.length,
      });
      setActiveAlert(alert);
      setShowOptions(false);

      // Pre-fill a text to each selected emergency contact with the chosen
      // message + a maps link. There's no SMS gateway here, so this opens
      // the native composer (WhatsApp first, SMS fallback) — the person
      // still has to hit send for each.
      for (const c of toAlert) {
        await alertEmergencyContact(c.phone, loc.lat, loc.lng, messageBody);
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
            <Text style={styles.activeSub}>Your emergency contacts can see your location.</Text>
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
              Only your own emergency contacts are ever notified — nobody else on the app sees this.
            </Text>
            <PrimaryButton
              label={triggering ? "Sending..." : "Alert Emergency Contacts"}
              onPress={handleTrigger}
              disabled={triggering}
              danger
            />
            <Pressable
              onPress={() => setShowOptions((v) => !v)}
              style={styles.publicToggle}
            >
              <Ionicons name="options-outline" size={15} color={COLORS.textDim} />
              <Text style={styles.publicToggleTxt}>
                {showOptions ? "Hide options" : "Choose message & who to notify"}
              </Text>
            </Pressable>

            {showOptions && (
              <View style={styles.consentBox}>
                <Text style={styles.optionsLabel}>Message</Text>
                <View style={styles.templateRow}>
                  {EMERGENCY_MESSAGE_TEMPLATES.map((t) => (
                    <Pressable
                      key={t.id}
                      onPress={() => setTemplateId(t.id)}
                      style={[styles.templateChip, templateId === t.id && styles.templateChipActive]}
                    >
                      <Text style={[styles.templateChipTxt, templateId === t.id && styles.templateChipTxtActive]}>
                        {t.label}
                      </Text>
                    </Pressable>
                  ))}
                  <Pressable
                    onPress={() => setTemplateId("custom")}
                    style={[styles.templateChip, templateId === "custom" && styles.templateChipActive]}
                  >
                    <Text style={[styles.templateChipTxt, templateId === "custom" && styles.templateChipTxtActive]}>
                      Custom
                    </Text>
                  </Pressable>
                </View>

                {templateId === "custom" ? (
                  <TextField
                    label="Custom message"
                    placeholder="What should your contacts know?"
                    value={customMessage}
                    onChangeText={setCustomMessage}
                  />
                ) : (
                  <Text style={styles.templatePreview}>
                    "{EMERGENCY_MESSAGE_TEMPLATES.find((t) => t.id === templateId)?.body}"
                  </Text>
                )}

                <Text style={[styles.optionsLabel, { marginTop: 6 }]}>Notify</Text>
                {contacts.length === 0 ? (
                  <Text style={styles.emptyTxt}>Add an emergency contact below first.</Text>
                ) : (
                  contacts.map((c) => (
                    <Pressable
                      key={c.id}
                      style={styles.contactCheckRow}
                      onPress={() => toggleContact(c.id)}
                    >
                      <Ionicons
                        name={selectedContactIds.has(c.id) ? "checkbox" : "square-outline"}
                        size={20}
                        color={selectedContactIds.has(c.id) ? COLORS.red : COLORS.textFaint}
                      />
                      <Text style={styles.contactCheckTxt}>{c.name} — {c.phone}</Text>
                    </Pressable>
                  ))
                )}
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
  optionsLabel: {
    color: COLORS.textFaint, fontSize: 11, letterSpacing: 1.5,
    textTransform: "uppercase", fontWeight: "800",
  },
  templateRow: { flexDirection: "row", flexWrap: "wrap", gap: 8 },
  templateChip: {
    paddingHorizontal: 12, paddingVertical: 7, borderRadius: RADIUS.md,
    borderWidth: 1, borderColor: "rgba(255,255,255,0.14)",
    backgroundColor: "rgba(255,255,255,0.04)",
  },
  templateChipActive: { backgroundColor: COLORS.red, borderColor: COLORS.red },
  templateChipTxt: { color: COLORS.textDim, fontSize: 12, fontWeight: "700" },
  templateChipTxtActive: { color: "#000" },
  templatePreview: { color: COLORS.textDim, fontSize: 12, fontStyle: "italic", lineHeight: 17 },
  contactCheckRow: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 4 },
  contactCheckTxt: { flex: 1, color: COLORS.text, fontSize: 13, fontWeight: "700" },
});