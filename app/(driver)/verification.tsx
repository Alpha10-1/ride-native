import React, { useCallback, useState } from "react";
import { View, Text, StyleSheet, ScrollView, ActivityIndicator, Alert, Pressable } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as ImagePicker from "expo-image-picker";
import { useFocusEffect } from "expo-router";

import Screen from "../../src/components/Screen";
import RiderHeader from "../../src/components/RiderHeader";
import SideMenuDrawer from "../../src/components/SideMenuDrawer";
import GlassCard from "../../src/components/GlassCard";
import { COLORS, SPACE, RADIUS } from "../../src/theme/tokens";
import {
  REQUIRED_DOCS, DocType, DriverDocument, VerificationStatus,
  getMyDocuments, getMyVerificationStatus, uploadVerificationDocument, docStatusFor,
} from "../../src/lib/verification";

const STATUS_META: Record<VerificationStatus, { label: string; color: string }> = {
  unverified: { label: "Not started", color: COLORS.textDim },
  pending: { label: "Under review", color: "#ffb020" },
  verified: { label: "Verified", color: "rgba(120,220,150,0.95)" },
  rejected: { label: "Action needed", color: COLORS.red },
};

const DOC_STATUS_META: Record<string, { label: string; color: string; icon: keyof typeof Ionicons.glyphMap }> = {
  not_submitted: { label: "Not uploaded", color: COLORS.textFaint, icon: "cloud-upload-outline" },
  pending: { label: "Pending review", color: "#ffb020", icon: "time-outline" },
  approved: { label: "Approved", color: "rgba(120,220,150,0.95)", icon: "checkmark-circle" },
  rejected: { label: "Rejected", color: COLORS.red, icon: "close-circle" },
};

export default function VerificationScreen() {
  const [menuOpen, setMenuOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [docs, setDocs] = useState<DriverDocument[]>([]);
  const [status, setStatus] = useState<VerificationStatus>("unverified");
  const [notes, setNotes] = useState<string | null>(null);
  const [uploadingType, setUploadingType] = useState<DocType | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [d, v] = await Promise.all([getMyDocuments(), getMyVerificationStatus()]);
      setDocs(d);
      setStatus(v.status);
      setNotes(v.notes);
    } catch (e: any) {
      setError(e?.message ?? "Failed to load verification status.");
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      load();
    }, [load])
  );

  const handleUpload = async (docType: DocType) => {
    const { status: permStatus } = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (permStatus !== "granted") {
      Alert.alert("Permission needed", "Please allow photo library access to upload a document.");
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      allowsEditing: true,
    });
    if (result.canceled) return;

    setError(null);
    setUploadingType(docType);
    try {
      await uploadVerificationDocument(docType, result.assets[0].uri);
      await load();
    } catch (e: any) {
      Alert.alert("Upload failed", e?.message ?? "Please try again.");
    } finally {
      setUploadingType(null);
    }
  };

  if (loading) {
    return (
      <Screen>
        <RiderHeader subtitle="Verification" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
        <View style={styles.centerFill}>
          <ActivityIndicator color={COLORS.red} />
        </View>
        <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
      </Screen>
    );
  }

  const meta = STATUS_META[status];

  return (
    <Screen>
      <RiderHeader subtitle="Verification" menuOpen={menuOpen} onMenu={() => setMenuOpen((v) => !v)} />
      <ScrollView
        contentContainerStyle={{ paddingHorizontal: SPACE.md, paddingBottom: 120, gap: SPACE.sm }}
        showsVerticalScrollIndicator={false}
      >
        <GlassCard>
          <View style={styles.statusRow}>
            <Text style={styles.kicker}>ACCOUNT STATUS</Text>
            <View style={[styles.statusPill, { borderColor: meta.color }]}>
              <View style={[styles.statusDot, { backgroundColor: meta.color }]} />
              <Text style={[styles.statusPillTxt, { color: meta.color }]}>{meta.label}</Text>
            </View>
          </View>
          <Text style={styles.sub}>
            {status === "verified"
              ? "You're fully verified and can go online to accept rides."
              : status === "rejected"
              ? notes ?? "One or more documents need attention — see below."
              : "Upload the documents below. You can go online once all three are approved."}
          </Text>
        </GlassCard>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Text style={styles.section}>Required Documents</Text>
        {REQUIRED_DOCS.map((doc) => {
          const docStatus = docStatusFor(docs, doc.type);
          const dMeta = DOC_STATUS_META[docStatus];
          const rejected = docs.find((d) => d.doc_type === doc.type && d.status === "rejected");
          const isUploading = uploadingType === doc.type;

          return (
            <GlassCard key={doc.type} style={styles.docCard}>
              <View style={styles.docRow}>
                <View style={styles.docIconWrap}>
                  <Ionicons name={doc.icon as any} size={20} color={COLORS.red} />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.docTitle}>{doc.label}</Text>
                  <Text style={styles.docDesc}>{doc.description}</Text>
                  <View style={styles.docStatusRow}>
                    <Ionicons name={dMeta.icon} size={14} color={dMeta.color} />
                    <Text style={[styles.docStatusTxt, { color: dMeta.color }]}>{dMeta.label}</Text>
                  </View>
                  {rejected?.rejection_reason ? (
                    <Text style={styles.rejectReason}>{rejected.rejection_reason}</Text>
                  ) : null}
                </View>
              </View>

              <Pressable
                style={({ pressed }) => [
                  styles.uploadBtn,
                  isUploading && { opacity: 0.6 },
                  pressed && !isUploading && { transform: [{ scale: 0.97 }] },
                ]}
                disabled={isUploading}
                onPress={() => handleUpload(doc.type)}
              >
                {isUploading ? (
                  <ActivityIndicator color="#000" size="small" />
                ) : (
                  <Text style={styles.uploadBtnTxt}>
                    {docStatus === "not_submitted" ? "Upload" : "Re-upload"}
                  </Text>
                )}
              </Pressable>
            </GlassCard>
          );
        })}
      </ScrollView>
      <SideMenuDrawer open={menuOpen} onClose={() => setMenuOpen(false)} role="driver" />
    </Screen>
  );
}

const styles = StyleSheet.create({
  centerFill: { flex: 1, alignItems: "center", justifyContent: "center" },
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  sub: { color: COLORS.textDim, marginTop: 10, fontSize: 13, lineHeight: 18 },
  statusRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  statusPill: {
    flexDirection: "row", alignItems: "center", gap: 6,
    borderWidth: 1, borderRadius: RADIUS.pill,
    paddingHorizontal: 10, paddingVertical: 5,
  },
  statusDot: { width: 6, height: 6, borderRadius: 3 },
  statusPillTxt: { fontSize: 11, fontWeight: "800" },
  section: {
    marginTop: SPACE.md,
    marginBottom: 6,
    paddingLeft: 4,
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "800",
  },
  docCard: { flexDirection: "row", alignItems: "center", gap: SPACE.sm },
  docRow: { flex: 1, flexDirection: "row", gap: SPACE.sm },
  docIconWrap: {
    width: 42, height: 42, borderRadius: 999,
    alignItems: "center", justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.06)",
    borderWidth: 1, borderColor: "rgba(255,255,255,0.10)",
  },
  docTitle: { color: COLORS.text, fontWeight: "900", fontSize: 14 },
  docDesc: { color: COLORS.textDim, fontSize: 12, marginTop: 2 },
  docStatusRow: { flexDirection: "row", alignItems: "center", gap: 6, marginTop: 8 },
  docStatusTxt: { fontSize: 12, fontWeight: "800" },
  rejectReason: { color: COLORS.red, fontSize: 11, marginTop: 6, lineHeight: 15 },
  uploadBtn: {
    height: 40, minWidth: 88, paddingHorizontal: 14,
    borderRadius: RADIUS.md, backgroundColor: COLORS.red,
    alignItems: "center", justifyContent: "center",
  },
  uploadBtnTxt: { color: "#000", fontWeight: "900", fontSize: 13 },
  error: { color: "rgba(255,90,90,0.95)", fontWeight: "700", paddingHorizontal: 4 },
});