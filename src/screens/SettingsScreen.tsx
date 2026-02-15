// src/screens/SettingsScreen.tsx
import React from "react";
import { View, Text, StyleSheet, ScrollView } from "react-native";
import Screen from "../components/Screen";
import AppHeader from "../components/AppHeader";
import GlassCard from "../components/GlassCard";
import SettingRow from "../components/SettingRow";
import { COLORS, SPACE } from "../theme/tokens";

// Use any icon set you choose later (lucide-react-native, @expo/vector-icons, etc.)
// For now, pass simple placeholders like <Text>👤</Text>

export default function SettingsScreen({ navigation }: any) {
  const sections = [
    {
      header: "Account",
      rows: [
        { title: "Profile", desc: "Name, email, photo", icon: "👤", to: "Profile" },
        { title: "Phone number", desc: "Verify / change number", icon: "📱", to: "Phone" },
        { title: "Saved places", desc: "Home, Work, favourites", icon: "📍", to: "Places" },
      ],
    },
    {
      header: "Payment & rewards",
      rows: [
        { title: "Payments", desc: "Cash / card options", icon: "💳", to: "Payments" },
        { title: "Ride Credits", desc: "Balance, history", icon: "⭐", to: "Credits" },
        { title: "Promotions", desc: "Deals & vouchers", icon: "🎟️", to: "Promotions" },
      ],
    },
    {
      header: "Safety",
      rows: [
        { title: "Safety tools", desc: "Emergency, share trip", icon: "🛡️", to: "Safety" },
        { title: "Emergency contacts", desc: "Add people to notify", icon: "❤️", to: "Emergency" },
        { title: "Trip PIN", desc: "Add extra verification", icon: "🔑", to: "Pin" },
      ],
    },
    {
      header: "Preferences",
      rows: [
        { title: "Notifications", desc: "Push + SMS preferences", icon: "🔔", to: "Notifications" },
        { title: "Language", desc: "App language", icon: "🌍", to: "Language" },
        { title: "Appearance", desc: "Theme & display", icon: "🌙", to: "Appearance" },
      ],
    },
    {
      header: "Privacy & legal",
      rows: [
        { title: "Privacy", desc: "Data & permissions", icon: "🔒", to: "Privacy" },
        { title: "Terms & policies", desc: "Legal documents", icon: "📄", to: "Legal" },
        { title: "About", desc: "Version info", icon: "ℹ️", to: "About" },
      ],
    },
    {
      header: "Support",
      rows: [{ title: "Help & Support", desc: "FAQs, contact us", icon: "💬", to: "Support" }],
    },
  ];

  return (
    <Screen>
      <AppHeader eyebrow="Rider" title="Settings" />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        <GlassCard style={{ marginBottom: SPACE.md }}>
          <Text style={styles.kicker}>MANAGE YOUR ACCOUNT</Text>
          <Text style={styles.sub}>
            Update personal info, safety, payments, and preferences.
          </Text>
        </GlassCard>

        {sections.map((section) => (
          <View key={section.header} style={{ marginBottom: SPACE.md }}>
            <Text style={styles.sectionHeader}>{section.header}</Text>

            <View style={{ gap: SPACE.sm }}>
              {section.rows.map((row) => (
                <SettingRow
                  key={row.title}
                  title={row.title}
                  desc={row.desc}
                  icon={<Text style={{ color: COLORS.text }}>{row.icon}</Text>}
                  right={<Text style={{ color: COLORS.text }}>›</Text>}
                  onPress={() => navigation?.navigate?.(row.to)}
                />
              ))}
            </View>
          </View>
        ))}

        <View style={{ marginTop: SPACE.sm, marginBottom: SPACE.xl }}>
          <SettingRow
            title="Log out"
            desc="Sign out of your account"
            icon={<Text style={{ color: COLORS.red }}>⎋</Text>}
            right={<Text style={{ color: COLORS.red }}>›</Text>}
            onPress={() => {}}
          />
        </View>
      </ScrollView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  content: {
    paddingHorizontal: SPACE.md,
    paddingBottom: 120,
  },
  kicker: {
    color: COLORS.textDim,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "700",
    opacity: 0.9,
  },
  sub: { color: COLORS.textDim, fontSize: 13, marginTop: 6, lineHeight: 18 },
  sectionHeader: {
    color: COLORS.textFaint,
    fontSize: 11,
    letterSpacing: 2,
    textTransform: "uppercase",
    fontWeight: "700",
    marginBottom: SPACE.xs,
    paddingLeft: 4,
  },
});
