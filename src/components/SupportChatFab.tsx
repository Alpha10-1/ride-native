import React from "react";
import { Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { router } from "expo-router";

import { COLORS } from "../theme/tokens";

// Always-reachable "contact support" entry point, mounted alongside
// SOSFab on the same home/active-trip screens for both roles. SOSFab
// sits top-right for emergencies; this sits bottom-right so the two
// never compete for the same corner or get mixed up with each other —
// support chat is exactly what SupportChatScreen.tsx already handles
// (role-aware internally via the fetched profile), so this is just a
// quick door into it from wherever a rider/driver already is, instead of
// requiring them to dig through Settings > Support first.
export default function SupportChatFab({
  role = "rider",
  bottom = 100,
}: {
  role?: "rider" | "driver";
  bottom?: number;
}) {
  const base = role === "driver" ? "/(driver)" : "/(rider)";
  return (
    <Pressable
      style={[styles.fab, { bottom }]}
      onPress={() => router.push(`${base}/support-chat` as any)}
      hitSlop={8}
    >
      <Ionicons name="chatbubble-ellipses" size={22} color="#000" />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  fab: {
    position: "absolute",
    right: 16,
    width: 48,
    height: 48,
    borderRadius: 24,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOpacity: 0.4,
    shadowRadius: 8,
    shadowOffset: { width: 0, height: 4 },
    elevation: 6,
    zIndex: 50,
  },
});
